package com.vh.trend.ui

import android.app.Activity
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** What the system's Google account picker returned. */
sealed interface GoogleResult {
    data class Token(val idToken: String) : GoogleResult
    data object Cancelled : GoogleResult
    data class Failed(val message: String) : GoogleResult
}

/**
 * Google sign-in through Credential Manager: the picker shows the accounts on the phone and returns an ID token for
 * [webClientId] (the project's "Web client"). It only works for an APK whose signing certificate's SHA-1 is registered
 * with the Firebase project (infra/README.md, step 8).
 */
object GoogleSignIn {
    private const val TAG = "GoogleSignIn"

    suspend fun pick(activity: Activity, webClientId: String): GoogleResult = try {
        val option = GetSignInWithGoogleOption.Builder(webClientId).build()
        val result = CredentialManager.create(activity).getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
        val credential = result.credential
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            GoogleResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
        } else {
            GoogleResult.Failed("Không nhận được tài khoản Google.")
        }
    } catch (_: GetCredentialCancellationException) {
        GoogleResult.Cancelled
    } catch (_: NoCredentialException) {
        GoogleResult.Failed("Máy chưa có tài khoản Google. Thêm tài khoản trong Cài đặt của điện thoại rồi thử lại.")
    } catch (e: GetCredentialException) {
        Log.w(TAG, "Credential Manager failed", e)
        GoogleResult.Failed("Đăng nhập Google không thành công (${e.type.substringAfterLast('.')}). Nếu lỗi lặp lại: SHA-1 của APK chưa được đăng ký (infra/README.md, bước 8).")
    }

    /** Lets the next sign-in show the account picker again. */
    suspend fun forget(activity: Activity) {
        runCatching { CredentialManager.create(activity).clearCredentialState(ClearCredentialStateRequest()) }
    }
}
