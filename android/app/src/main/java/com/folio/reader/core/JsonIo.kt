package com.folio.reader.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 小 json 的读写。
 *
 * 写一律「先写 tmp，再 rename」：手机随时可能被系统杀掉或没电，
 * 直接覆盖会出现「一半的 books.json」—— 那种文件下次启动解析失败，
 * 用户看到的是整个书架凭空消失。
 *
 * 目录不存在会自动创建；任何异常都吞成 null / false，
 * 让调用方（Store）自己决定降级策略，而不是把 IO 异常抛到 UI 线程。
 */
object JsonIo {

    /** 读一个 JSONObject；文件不存在或内容坏了返回 null。 */
    fun readObject(file: File): JSONObject? {
        val text = readText(file) ?: return null
        return runCatching { JSONObject(text) }.getOrNull()
    }

    /** 读一个 JSONArray；文件不存在或内容坏了返回 null。 */
    fun readArray(file: File): JSONArray? {
        val text = readText(file) ?: return null
        return runCatching { JSONArray(text) }.getOrNull()
    }

    /** 读文本；不存在或读失败返回 null。 */
    fun readText(file: File): String? {
        if (!file.isFile) return null
        return runCatching { file.readText(Charsets.UTF_8) }.getOrNull()
    }

    /** 原子写一个 JSONObject。成功返回 true。 */
    fun write(file: File, json: JSONObject): Boolean = writeText(file, json.toString())

    /** 原子写一个 JSONArray。成功返回 true。 */
    fun write(file: File, array: JSONArray): Boolean = writeText(file, array.toString())

    /**
     * 原子写文本：`<name>.tmp` → rename 到目标。
     *
     * Android 的 rename(2) 会直接覆盖已存在的目标；Windows 上不会，
     * 所以先删目标再 rename，失败再退回直写（单测在 JVM 上跑得到这条路）。
     */
    fun writeText(file: File, text: String): Boolean {
        val parent = file.parentFile
        if (parent != null && !parent.isDirectory && !parent.mkdirs()) return false
        val tmp = File(parent, file.name + ".tmp")
        return try {
            tmp.writeText(text, Charsets.UTF_8)
            if (file.exists()) file.delete()
            if (tmp.renameTo(file)) return true
            // rename 失败（跨盘/被占用）：退回直写，至少别丢数据
            file.writeText(text, Charsets.UTF_8)
            tmp.delete()
            true
        } catch (err: Exception) {
            runCatching { tmp.delete() }
            false
        }
    }

    /** 删掉一个文件（不存在也算成功）。 */
    fun delete(file: File): Boolean = !file.exists() || file.delete()

    /** 递归统计目录下所有文件的字节数（目录不存在返回 0）。 */
    fun sizeOf(dir: File): Long {
        if (!dir.exists()) return 0L
        var total = 0L
        dir.walkTopDown().forEach { if (it.isFile) total += it.length() }
        return total
    }

    /** 递归统计目录下所有文件的数量（目录不存在返回 0）。 */
    fun countOf(dir: File): Int {
        if (!dir.exists()) return 0
        var total = 0
        dir.walkTopDown().forEach { if (it.isFile) total += 1 }
        return total
    }
}
