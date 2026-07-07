package com.naonao.app.android;

import android.Manifest;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.security.NetworkSecurityPolicy;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

public class MainActivity extends Activity {
    private static final String SMOKE_TAG = "NAONAO_SMOKE";

    private WebView webView;
    private AndroidBridge androidBridge;
    private boolean pageReady = false;
    private int safeInsetLeft = 0;
    private int safeInsetTop = 0;
    private int safeInsetRight = 0;
    private int safeInsetBottom = 0;
    private float density = 1f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        density = Math.max(1f, getResources().getDisplayMetrics().density);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);
        installWindowInsetsBridge();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(false);
        settings.setSupportMultipleWindows(false);
        settings.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            settings.setSafeBrowsingEnabled(true);
        }

        WebView.setWebContentsDebuggingEnabled(false);
        androidBridge = new AndroidBridge(this, webView);
        webView.addJavascriptInterface(androidBridge, "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url == null || !url.startsWith("file:///android_asset/")) return;
                pageReady = true;
                applyWindowInsetsToPage();
                view.evaluateJavascript(
                        "(function(){return JSON.stringify({" +
                                "title:document.title," +
                                "nav:document.querySelectorAll('.bottom-nav button').length," +
                                "home:!!document.getElementById('view-home')," +
                                "naonao:!!window.NAONAO," +
                                "bridge:!!window.AndroidBridge" +
                                "});})()",
                        value -> Log.i(SMOKE_TAG, value == null ? "null" : value)
                );
            }

            private boolean handleUrl(Uri uri) {
                if (uri == null) return true;
                String scheme = uri.getScheme();
                if ("file".equalsIgnoreCase(scheme)) {
                    return !uri.toString().startsWith("file:///android_asset/");
                }
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {}
                    return true;
                }
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void installWindowInsetsBridge() {
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            updateSafeAreaInsets(readSafeAreaInsets(insets));
            return insets;
        });
        webView.post(() -> {
            if (webView != null) webView.requestApplyInsets();
        });
    }

    private void updateSafeAreaInsets(int[] insets) {
        if (insets == null || insets.length != 4) return;
        int cssLeft = toCssPx(insets[0]);
        int cssTop = toCssPx(insets[1]);
        int cssRight = toCssPx(insets[2]);
        int cssBottom = toCssPx(insets[3]);
        if (safeInsetLeft == cssLeft
                && safeInsetTop == cssTop
                && safeInsetRight == cssRight
                && safeInsetBottom == cssBottom) {
            return;
        }
        safeInsetLeft = cssLeft;
        safeInsetTop = cssTop;
        safeInsetRight = cssRight;
        safeInsetBottom = cssBottom;
        applyWindowInsetsToPage();
    }

    private int toCssPx(int physicalPx) {
        return Math.round(Math.max(0, physicalPx) / density);
    }

    private void applyWindowInsetsToPage() {
        if (!pageReady || webView == null) return;
        String script = "(function(){var s=document.documentElement.style;"
                + "s.setProperty('--safe-left','" + safeInsetLeft + "px');"
                + "s.setProperty('--safe-top','" + safeInsetTop + "px');"
                + "s.setProperty('--safe-right','" + safeInsetRight + "px');"
                + "s.setProperty('--safe-bottom','" + safeInsetBottom + "px');"
                + "})()";
        webView.evaluateJavascript(script, null);
    }

    private static int[] readSafeAreaInsets(WindowInsets insets) {
        if (insets == null) return new int[]{0, 0, 0, 0};
        if (Build.VERSION.SDK_INT >= 30) return Api30Insets.read(insets);

        int left = Math.max(0, insets.getSystemWindowInsetLeft());
        int top = Math.max(0, insets.getSystemWindowInsetTop());
        int right = Math.max(0, insets.getSystemWindowInsetRight());
        int bottom = Math.max(0, insets.getSystemWindowInsetBottom());
        if (Build.VERSION.SDK_INT >= 28) {
            return Api28Insets.mergeDisplayCutout(insets, left, top, right, bottom);
        }
        return new int[]{left, top, right, bottom};
    }

    @TargetApi(28)
    private static class Api28Insets {
        static int[] mergeDisplayCutout(WindowInsets insets, int left, int top, int right, int bottom) {
            android.view.DisplayCutout cutout = insets.getDisplayCutout();
            if (cutout != null) {
                left = Math.max(left, cutout.getSafeInsetLeft());
                top = Math.max(top, cutout.getSafeInsetTop());
                right = Math.max(right, cutout.getSafeInsetRight());
                bottom = Math.max(bottom, cutout.getSafeInsetBottom());
            }
            return new int[]{left, top, right, bottom};
        }
    }

    @TargetApi(30)
    private static class Api30Insets {
        static int[] read(WindowInsets insets) {
            Insets systemBars = insets.getInsets(WindowInsets.Type.systemBars());
            Insets displayCutout = insets.getInsets(WindowInsets.Type.displayCutout());
            return new int[]{
                    Math.max(systemBars.left, displayCutout.left),
                    Math.max(systemBars.top, displayCutout.top),
                    Math.max(systemBars.right, displayCutout.right),
                    Math.max(systemBars.bottom, displayCutout.bottom)
            };
        }
    }

    @Override
    protected void onDestroy() {
        pageReady = false;
        if (androidBridge != null) {
            androidBridge.shutdown();
            androidBridge = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "window.NAONAO && window.NAONAO.onAndroidBack ? window.NAONAO.onAndroidBack() : false",
                value -> {
                    if (!"true".equals(value)) {
                        MainActivity.super.onBackPressed();
                    }
                }
        );
    }

    public static class AndroidBridge {
        private static final int MAX_RESPONSE_CHARS = 120000;

        private final Activity activity;
        private final WebView webView;
        private final Handler mainHandler = new Handler(Looper.getMainLooper());
        private final ExecutorService executor = Executors.newFixedThreadPool(3);
        private final SecretStore secretStore;
        private volatile boolean closed = false;

        AndroidBridge(Activity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
            this.secretStore = new SecretStore(activity.getApplicationContext());
        }

        @JavascriptInterface
        public String getPlatformInfo() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("platform", "android");
                obj.put("sdk", Build.VERSION.SDK_INT);
                obj.put("model", Build.MODEL);
                obj.put("app", "naonao");
            } catch (JSONException ignored) {}
            return obj.toString();
        }

        @JavascriptInterface
        public boolean saveSecret(String name, String value) {
            return secretStore.save(safeSecretName(name), value == null ? "" : value);
        }

        @JavascriptInterface
        public boolean hasSecret(String name) {
            return secretStore.has(safeSecretName(name));
        }

        @JavascriptInterface
        public boolean deleteSecret(String name) {
            return secretStore.delete(safeSecretName(name));
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            int duration = Math.max(10, Math.min(600, ms));
            Vibrator vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(duration);
            }
        }

        @JavascriptInterface
        public void notifyNow(String title, String body) {
            ReminderReceiver.showNotification(activity.getApplicationContext(), title, body);
        }

        @JavascriptInterface
        public boolean ensureNotificationPermission() {
            if (Build.VERSION.SDK_INT < 33) return true;
            if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                return true;
            }
            activity.runOnUiThread(() -> activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 43));
            return false;
        }

        @JavascriptInterface
        public void scheduleReminder(String id, String title, String body, long delayMs, long repeatMs) {
            ReminderReceiver.schedule(
                    activity.getApplicationContext(),
                    safeReminderId(id),
                    title,
                    body,
                    Math.max(1000L, delayMs),
                    Math.max(0L, repeatMs)
            );
        }

        @JavascriptInterface
        public void cancelReminder(String id) {
            ReminderReceiver.cancel(activity.getApplicationContext(), safeReminderId(id));
        }

        @JavascriptInterface
        public void cancelAllReminders() {
            ReminderReceiver.cancelAll(activity.getApplicationContext());
        }

        @JavascriptInterface
        public void openExternal(String url) {
            try {
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme();
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return;
                activity.startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            if (Build.VERSION.SDK_INT >= 26) {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
                activity.startActivity(intent);
            } else {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(intent);
            }
        }

        @JavascriptInterface
        public boolean shareText(String title, String text) {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("application/json");
                send.putExtra(Intent.EXTRA_SUBJECT, title == null ? "孬孬 Android 数据导出" : title);
                send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                Intent chooser = Intent.createChooser(send, "导出孬孬数据");
                activity.startActivity(chooser);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void chatProvider(String configJson, String callbackId) {
            executeAsync(callbackId, () -> chatProviderInternal(configJson));
        }

        @JavascriptInterface
        public void chatHermes(String configJson, String callbackId) {
            executeAsync(callbackId, () -> chatHermesInternal(configJson));
        }

        @JavascriptInterface
        public void sendFeishu(String secretName, String text, String callbackId) {
            executeAsync(callbackId, () -> {
                JSONObject result = new JSONObject();
                try {
                    String webhook = secretStore.read(safeSecretName(secretName));
                    if (webhook == null || webhook.trim().isEmpty()) {
                        throw new IOException("Webhook 未保存");
                    }
                    if (!isValidFeishuWebhook(webhook)) {
                        throw new IOException("Webhook 地址不合法");
                    }
                    JSONObject body = new JSONObject()
                            .put("msg_type", "text")
                            .put("content", new JSONObject().put("text", String.valueOf(text)));
                    JSONObject response = postJson(webhook, new JSONObject(), body, 15000);
                    if (!response.optBoolean("success")) {
                        throw new IOException(response.optString("error", "发送失败"));
                    }
                    result.put("success", true);
                } catch (Exception e) {
                    putError(result, e);
                }
                return result;
            });
        }

        void shutdown() {
            closed = true;
            mainHandler.removeCallbacksAndMessages(null);
            executor.shutdownNow();
        }

        private void executeAsync(String callbackId, NativeCall call) {
            if (closed) return;
            try {
                executor.execute(() -> {
                    if (closed) return;
                    JSONObject result;
                    try {
                        result = call.run();
                    } catch (Exception e) {
                        result = new JSONObject();
                        putError(result, e);
                    }
                    deliver(callbackId, result);
                });
            } catch (RuntimeException e) {
                JSONObject result = new JSONObject();
                putError(result, e);
                deliver(callbackId, result);
            }
        }

        private JSONObject chatProviderInternal(String configJson) {
            JSONObject result = new JSONObject();
            try {
                JSONObject config = new JSONObject(configJson == null ? "{}" : configJson);
                String apiKey = secretStore.read("provider_api_key");
                if (apiKey == null || apiKey.trim().isEmpty()) {
                    throw new IOException("API Key 未保存");
                }
                String provider = config.optString("provider", "anthropic");
                String model = config.optString("model", "");
                int maxTokens = Math.max(64, Math.min(2000, config.optInt("maxTokens", 500)));
                String system = config.optString("system", "");
                JSONArray messages = config.optJSONArray("messages");
                if (messages == null) messages = new JSONArray();

                JSONObject headers = new JSONObject().put("Content-Type", "application/json");
                JSONObject body = new JSONObject();
                String endpoint;
                if ("openai".equals(provider)) {
                    endpoint = normalizeOpenAIEndpoint(config.optString("baseUrl", ""));
                    if (isThirdPartyUrl(endpoint) && !config.optBoolean("allowThirdPartyBaseUrl")) {
                        throw new IOException("自定义 Base URL 需要确认后才能发送 API Key");
                    }
                    headers.put("Authorization", "Bearer " + apiKey);
                    JSONArray openAiMessages = new JSONArray();
                    if (!system.isEmpty()) {
                        openAiMessages.put(new JSONObject().put("role", "system").put("content", system));
                    }
                    for (int i = 0; i < messages.length(); i++) {
                        openAiMessages.put(messages.get(i));
                    }
                    body.put("model", model.isEmpty() ? "gpt-4o-mini" : model);
                    body.put("messages", openAiMessages);
                    body.put("max_tokens", maxTokens);
                    body.put("stream", false);
                } else {
                    endpoint = "https://api.anthropic.com/v1/messages";
                    headers.put("x-api-key", apiKey);
                    headers.put("anthropic-version", "2023-06-01");
                    body.put("model", model.isEmpty() ? "claude-3-5-sonnet-20241022" : model);
                    body.put("max_tokens", maxTokens);
                    if (!system.isEmpty()) body.put("system", system);
                    body.put("messages", messages);
                }

                JSONObject response = postJson(endpoint, headers, body, 45000);
                if (!response.optBoolean("success")) throw new IOException(response.optString("error", "AI 请求失败"));
                JSONObject parsed = new JSONObject(response.optString("body", "{}"));
                result.put("success", true);
                result.put("text", extractProviderText(provider, parsed));
            } catch (Exception e) {
                putError(result, e);
            }
            return result;
        }

        private JSONObject chatHermesInternal(String configJson) {
            JSONObject result = new JSONObject();
            try {
                JSONObject config = new JSONObject(configJson == null ? "{}" : configJson);
                String baseUrl = config.optString("baseUrl", "http://127.0.0.1:8642/v1");
                String endpoint = appendEndpoint(baseUrl, "chat/completions");
                if (isThirdPartyUrl(endpoint) && !config.optBoolean("allowThirdPartyBaseUrl")) {
                    throw new IOException("Hermes Base URL 需要确认后才能发送 Key");
                }
                JSONObject headers = new JSONObject().put("Content-Type", "application/json");
                String key = secretStore.read("hermes_api_key");
                if (key != null && !key.trim().isEmpty()) {
                    headers.put("Authorization", "Bearer " + key.trim());
                }
                JSONObject body = new JSONObject()
                        .put("model", config.optString("model", "hermes-agent"))
                        .put("messages", config.optJSONArray("messages") == null ? new JSONArray() : config.optJSONArray("messages"))
                        .put("max_tokens", Math.max(64, Math.min(2000, config.optInt("maxTokens", 500))))
                        .put("stream", false);
                JSONObject response = postJson(endpoint, headers, body, 45000);
                if (!response.optBoolean("success")) throw new IOException(response.optString("error", "Hermes 请求失败"));
                JSONObject parsed = new JSONObject(response.optString("body", "{}"));
                result.put("success", true);
                result.put("text", extractProviderText("openai", parsed));
            } catch (Exception e) {
                putError(result, e);
            }
            return result;
        }

        private void deliver(String callbackId, JSONObject result) {
            if (closed) return;
            String script = "window.NAONAO_NATIVE&&window.NAONAO_NATIVE.resolve(" +
                    JSONObject.quote(callbackId == null ? "" : callbackId) + "," + result.toString() + ")";
            mainHandler.post(() -> {
                if (!closed) webView.evaluateJavascript(script, null);
            });
        }

        private interface NativeCall {
            JSONObject run() throws Exception;
        }

        private static JSONObject postJson(String endpoint, JSONObject headers, JSONObject body, int timeoutMs) throws IOException, JSONException {
            ensureCleartextPermitted(endpoint);
            HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
            try {
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(timeoutMs);
                conn.setReadTimeout(timeoutMs);
                conn.setDoOutput(true);
                conn.setRequestProperty("Accept", "application/json");
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    conn.setRequestProperty(key, headers.optString(key));
                }
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(payload.length);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(payload);
                }
                int status = conn.getResponseCode();
                InputStream stream = status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream();
                String responseBody = readAll(stream, MAX_RESPONSE_CHARS);
                JSONObject result = new JSONObject();
                result.put("status", status);
                result.put("body", responseBody);
                result.put("success", status >= 200 && status < 300);
                if (status < 200 || status >= 300) {
                    result.put("error", "HTTP " + status + ": " + trimForError(responseBody));
                }
                return result;
            } finally {
                conn.disconnect();
            }
        }

        private static void ensureCleartextPermitted(String endpoint) throws IOException {
            Uri uri = Uri.parse(endpoint);
            if (!"http".equalsIgnoreCase(uri.getScheme())) return;
            String host = uri.getHost();
            if (host == null || host.trim().isEmpty()) {
                throw new IOException("HTTP 地址缺少主机名");
            }
            NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();
            boolean permitted = Build.VERSION.SDK_INT >= 24
                    ? policy.isCleartextTrafficPermitted(host)
                    : policy.isCleartextTrafficPermitted();
            if (!permitted) {
                throw new IOException("Android 已阻止明文 HTTP：" + host + "。请改用 HTTPS，或只使用手机本机的 127.0.0.1/localhost；电脑上的 Hermes 不能直接填手机的 127.0.0.1。");
            }
        }

        private static String readAll(InputStream stream, int maxChars) throws IOException {
            if (stream == null) return "";
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null && sb.length() < maxChars) {
                    int remaining = maxChars - sb.length();
                    sb.append(line, 0, Math.min(remaining, line.length()));
                }
            }
            return sb.toString();
        }

        private static String extractProviderText(String provider, JSONObject body) {
            if ("anthropic".equals(provider)) {
                JSONArray content = body.optJSONArray("content");
                if (content != null && content.length() > 0) {
                    return content.optJSONObject(0) == null ? "" : content.optJSONObject(0).optString("text", "");
                }
                return "";
            }
            JSONArray choices = body.optJSONArray("choices");
            if (choices == null || choices.length() == 0) return "";
            JSONObject message = choices.optJSONObject(0) == null ? null : choices.optJSONObject(0).optJSONObject("message");
            return message == null ? "" : message.optString("content", "");
        }

        private static String normalizeOpenAIEndpoint(String baseUrl) throws IOException {
            String base = baseUrl == null ? "" : baseUrl.trim();
            if (base.isEmpty()) return "https://api.openai.com/v1/chat/completions";
            return appendEndpoint(base, "chat/completions");
        }

        private static String appendEndpoint(String baseUrl, String path) throws IOException {
            String base = baseUrl == null ? "" : baseUrl.trim();
            if (base.isEmpty()) throw new IOException("Base URL 不能为空");
            if (!base.startsWith("http://") && !base.startsWith("https://")) {
                throw new IOException("Base URL 只支持 http/https");
            }
            while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
            if (base.endsWith("/chat/completions")) return base;
            return base + "/" + path;
        }

        private static boolean isThirdPartyUrl(String endpoint) {
            try {
                Uri uri = Uri.parse(endpoint);
                String host = uri.getHost();
                if (host == null) return true;
                String lower = host.toLowerCase(Locale.ROOT);
                return !("api.openai.com".equals(lower)
                        || "api.anthropic.com".equals(lower)
                        || "127.0.0.1".equals(lower)
                        || "localhost".equals(lower)
                        || lower.endsWith(".localhost"));
            } catch (Exception e) {
                return true;
            }
        }

        private static boolean isValidFeishuWebhook(String value) {
            try {
                Uri uri = Uri.parse(value);
                String host = uri.getHost();
                String path = uri.getPath();
                return "https".equalsIgnoreCase(uri.getScheme())
                        && ("open.feishu.cn".equalsIgnoreCase(host) || "open.larksuite.com".equalsIgnoreCase(host))
                        && path != null
                        && path.startsWith("/open-apis/bot/v2/hook/");
            } catch (Exception e) {
                return false;
            }
        }

        private static String safeSecretName(String name) {
            String value = name == null ? "" : name.trim();
            if (!value.matches("[A-Za-z0-9_.:-]{1,80}")) return "invalid";
            return value;
        }

        private static String safeReminderId(String id) {
            String value = id == null ? "" : id.trim();
            if (!value.matches("[A-Za-z0-9_.:-]{1,80}")) return "naonao";
            return value;
        }

        private static void putError(JSONObject target, Exception e) {
            try {
                target.put("success", false);
                target.put("error", e == null ? "未知错误" : String.valueOf(e.getMessage()));
            } catch (JSONException ignored) {}
        }

        private static String trimForError(String body) {
            String value = body == null ? "" : body.replaceAll("\\s+", " ").trim();
            return value.length() > 260 ? value.substring(0, 260) : value;
        }
    }

    private static class SecretStore {
        private static final String PREF = "naonao_secrets";
        private static final String KEY_ALIAS = "naonao_android_secret_v1";
        private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
        private static final String CIPHER = "AES/GCM/NoPadding";

        private final SharedPreferences prefs;

        SecretStore(Context context) {
            prefs = context.getSharedPreferences(PREF, Context.MODE_PRIVATE);
            ensureKey();
        }

        boolean has(String name) {
            return prefs.contains(name);
        }

        boolean save(String name, String value) {
            if ("invalid".equals(name)) return false;
            try {
                if (value == null || value.trim().isEmpty()) {
                    return delete(name);
                }
                Cipher cipher = Cipher.getInstance(CIPHER);
                cipher.init(Cipher.ENCRYPT_MODE, getKey());
                byte[] iv = cipher.getIV();
                byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
                JSONObject obj = new JSONObject()
                        .put("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                        .put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));
                prefs.edit().putString(name, obj.toString()).apply();
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        String read(String name) {
            try {
                String raw = prefs.getString(name, null);
                if (raw == null) return null;
                JSONObject obj = new JSONObject(raw);
                byte[] iv = Base64.decode(obj.optString("iv"), Base64.NO_WRAP);
                byte[] data = Base64.decode(obj.optString("data"), Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance(CIPHER);
                cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
                byte[] plain = cipher.doFinal(data);
                return new String(plain, StandardCharsets.UTF_8);
            } catch (Exception e) {
                return null;
            }
        }

        boolean delete(String name) {
            prefs.edit().remove(name).apply();
            return true;
        }

        private void ensureKey() {
            try {
                KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
                store.load(null);
                if (store.containsAlias(KEY_ALIAS)) return;
                KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
                KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build();
                generator.init(spec);
                generator.generateKey();
            } catch (Exception ignored) {}
        }

        private SecretKey getKey() throws Exception {
            KeyStore store = KeyStore.getInstance(ANDROID_KEYSTORE);
            store.load(null);
            return (SecretKey) store.getKey(KEY_ALIAS, null);
        }
    }
}
