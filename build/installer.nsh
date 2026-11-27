; ---------------------------------------------------------------------------
; Folio 安装器外观
;
; electron-builder 在 MUI2 之后展开 customWelcomePage（assistedInstaller.nsh），
; 所以欢迎页的函数必须写在宏里 —— 否则解析到 !insertmacro MUI_HEADER_TEXT
; 时 MUI2 还没加载。配图由 tools/_gen-installer-art.mjs 生成：
;   build/installerSidebar.bmp  164×314
;   build/installerHeader.bmp   150×57
;
; 欢迎页用 MUI 的 1044 号对话框（左侧 164×314 竖图 + 右侧 195u 内容区）。
; 页面顺序：欢迎 → 安装位置 → 安装进度 → 完成。
; 「为谁安装」页被关掉（默认装到当前用户，不弹 UAC；需要全局安装时传 /allusers）。
; ---------------------------------------------------------------------------

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!macro customInstallmode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER

  !define MUI_DIRECTORYPAGE_TEXT_TOP "选择 Folio 的安装位置。安装只复制程序文件，不会改动你的书库；卸载同样会保留书籍、笔记与阅读进度。"

  !define MUI_FINISHPAGE_TEXT "Folio 已安装完成。$\r$\n$\r$\n书籍、笔记与阅读进度都保存在你的电脑上；打开书后可在设置里连接手机端。"
  !define MUI_FINISHPAGE_RUN_TEXT "立即启动 Folio"

  !macro customWelcomePage

    Function FolioWelcomeCreate
      nsDialogs::Create 1044
      Pop $0
      SetCtlColors $0 "" "FFFFFF"

      ; 左侧竖图（与卸载页共用同一张）
      File "/oname=$PLUGINSDIR\folio-sidebar.bmp" "${MUI_WELCOMEFINISHPAGE_BITMAP}"
      ${NSD_CreateBitmap} 0u 0u 109u 193u ""
      Pop $9
      !insertmacro MUI_INTERNAL_FULLWINDOW_LOADWIZARDIMAGE "" $9 "$PLUGINSDIR\folio-sidebar.bmp" $8

      CreateFont $4 "Microsoft YaHei UI" "15" "700"
      CreateFont $5 "Microsoft YaHei UI" "9" "400"
      CreateFont $1 "Microsoft YaHei UI" "9" "400"
      CreateFont $2 "Microsoft YaHei UI" "10" "600"
      CreateFont $3 "Microsoft YaHei UI" "8" "400"

      ; 标题
      ${NSD_CreateLabel} 120u 8u 195u 20u "欢迎使用 Folio"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $4 1
      SetCtlColors $0 "141413" "FFFFFF"

      ; 副标题
      ${NSD_CreateLabel} 120u 30u 195u 10u "本地优先的沉浸式阅读器"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $5 1
      SetCtlColors $0 "6B6963" "FFFFFF"

      ; 导语
      ${NSD_CreateLabel} 120u 48u 195u 44u "Folio 把书籍、笔记和阅读进度都留在你的电脑上。安装只复制文件，不联网，也不上传任何内容。"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $1 1
      SetCtlColors $0 "34322E" "FFFFFF"

      ; 橙色短线
      ${NSD_CreateLabel} 120u 94u 18u 2u ""
      Pop $0
      SetCtlColors $0 "D97757" "D97757"

      ; 三组特性：标题 + 说明
      ${NSD_CreateLabel} 120u 100u 195u 11u "本地优先"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $2 1
      SetCtlColors $0 "141413" "FFFFFF"
      ${NSD_CreateLabel} 120u 112u 195u 12u "书与笔记只存在本机，断网也能读"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $3 1
      SetCtlColors $0 "6B6963" "FFFFFF"

      ${NSD_CreateLabel} 120u 126u 195u 11u "一套排版"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $2 1
      SetCtlColors $0 "141413" "FFFFFF"
      ${NSD_CreateLabel} 120u 138u 195u 12u "PDF、EPUB 与漫画共用快捷键与阅读主题"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $3 1
      SetCtlColors $0 "6B6963" "FFFFFF"

      ${NSD_CreateLabel} 120u 152u 195u 11u "两端同步"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $2 1
      SetCtlColors $0 "141413" "FFFFFF"
      ${NSD_CreateLabel} 120u 164u 195u 12u "同一局域网内与手机互通过进度"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $3 1
      SetCtlColors $0 "6B6963" "FFFFFF"

      ; 底部说明
      ${NSD_CreateLabel} 120u 180u 195u 12u "安装位置可自选；卸载不会删除你的书、笔记与进度。"
      Pop $0
      SendMessage $0 ${WM_SETFONT} $3 1
      SetCtlColors $0 "8E8C84" "FFFFFF"

      nsDialogs::Show
      ${NSD_FreeImage} $8
    FunctionEnd

    Function FolioWelcomeLeave
    FunctionEnd

    Page custom FolioWelcomeCreate FolioWelcomeLeave
  !macroend

!endif
