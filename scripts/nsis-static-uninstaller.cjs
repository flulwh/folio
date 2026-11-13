'use strict';

/**
 * electron-builder 在 Windows 上生成 NSIS 卸载器的默认做法是：先把安装包编译成
 * 「BUILD_UNINSTALLER 桩」，再**把这个 exe 执行一遍**，让它自己 WriteUninstaller
 * 写出卸载器文件，最后才编译真正的安装包。
 *
 * 这一步对运行环境极其敏感。实测在 Windows 11 Insider Preview（10.0.29698）上，
 * NSIS 3.0.4.1 的 2019 年 stub 一启动就退出，退出码 2，`.onInit` 根本没有被调用，
 * 一个字节都不写 —— 于是整个 nsis 目标直接构建失败：
 *   ⨯ Exit code: 2. Command failed: ...\Folio-Setup-2.0.0.exe
 *
 * 但 electron-builder 自身就带着一条**不依赖执行**的路径：`UninstallerReader`
 * 直接解析安装包的 PE 节表 + NSIS 数据块，把内嵌的卸载器读出来（macOS Catalina
 * 分支走的就是它，见 nsisUtil.js）。这条路径是纯 JS 的，只读文件、不跑任何 exe。
 *
 * 本补丁把 Windows 上的卸载器生成切到「静态解析」，解析不出来才回退到原来的执行方式，
 * 所以对能正常执行的机器行为不变。
 */

const fs = require('fs/promises');
const path = require('path');

function install() {
  let NsisTarget;
  let nsisUtil;
  let execWine;
  let log;

  try {
    // 必须先加载 app-builder-lib 主入口：NsisTarget 继承自 index 里导出的 Target，
    // 单独 require 会因循环依赖报 "Class extends value undefined"
    require('app-builder-lib');
    ({ NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget'));
    nsisUtil = require('app-builder-lib/out/targets/nsis/nsisUtil');
    ({ execWine } = require('app-builder-lib/out/wine'));
    ({ log } = require('builder-util'));
  } catch (error) {
    // 不在 electron-builder 的运行环境里（比如被别的工具 require），静默跳过
    return;
  }

  const { nsisTemplatesDir, UninstallerReader } = nsisUtil;
  if (!NsisTarget || !UninstallerReader || typeof execWine !== 'function') {
    console.warn('[nsis-static-uninstaller] 跳过：找不到需要打补丁的模块');
    return;
  }

  const original = NsisTarget.prototype.computeScriptAndSignUninstaller;
  if (typeof original !== 'function' || original.__folioStaticUninstaller) {
    return;
  }

  async function computeScriptAndSignUninstaller(defines, commands, installerPath, sharedHeader, archs) {
    const packager = this.packager;
    const customScriptPath = await packager.getResource(this.options.script, 'installer.nsi');

    // 用了自定义 installer.nsi 时 electron-builder 本来就不生成卸载器，交回原实现
    if (customScriptPath != null) {
      return original.apply(this, arguments);
    }

    const script = await fs.readFile(path.join(nsisTemplatesDir, 'installer.nsi'), 'utf8');
    const uninstallerPath = path.join(
      this.outDir,
      `__uninstaller-${this.name}-${packager.appInfo.sanitizedName}.exe`,
    );

    defines.BUILD_UNINSTALLER = null;
    defines.UNINSTALLER_OUT_FILE =
      process.platform === 'win32' ? uninstallerPath : path.win32.join('Z:', uninstallerPath);

    // 第一步：编译出「只会写卸载器」的桩，输出路径就是 installerPath
    await this.executeMakensis(
      defines,
      commands,
      sharedHeader + (await this.computeFinalScript(script, false, archs)),
    );

    // 第二步：不执行桩，直接从二进制里把卸载器解析出来
    let extracted = false;
    try {
      await UninstallerReader.exec(installerPath, uninstallerPath);
      const stat = await fs.stat(uninstallerPath);
      extracted = stat.size > 0;
      if (!extracted) {
        await fs.unlink(uninstallerPath).catch(() => {});
      }
    } catch (error) {
      log.warn({ error: error.message }, 'static uninstaller extraction failed, falling back to executing installer');
    }

    if (!extracted) {
      await execWine(installerPath, null, [], { env: { __COMPAT_LAYER: 'RunAsInvoker' } });
    } else {
      log.info({ file: uninstallerPath }, 'uninstaller extracted statically (installer was not executed)');
    }

    await packager.sign(uninstallerPath);
    delete defines.BUILD_UNINSTALLER;
    defines.UNINSTALLER_OUT_FILE = uninstallerPath;
    return script;
  }

  computeScriptAndSignUninstaller.__folioStaticUninstaller = true;
  NsisTarget.prototype.computeScriptAndSignUninstaller = computeScriptAndSignUninstaller;
}

install();
