package com.vhub.scan

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

object Share {
    fun send(ctx: Context, file: File, mime: String) {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
        val i = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(i, file.name))
    }
}
