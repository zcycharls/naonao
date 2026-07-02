package com.naonao.app.android;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.Map;

public class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL_ID = "naonao_focus";
    private static final String ACTION_REMINDER = "com.naonao.app.android.REMINDER";
    private static final String PREF_SCHEDULES = "naonao_scheduled_reminders";
    private static final String KEY_PREFIX = "reminder_";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_REMINDER.equals(intent.getAction())) return;
        String id = intent.getStringExtra("id");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        long repeatMs = intent.getLongExtra("repeatMs", 0L);
        showNotification(context, title, body);
        if (repeatMs > 0L) {
            schedule(context, id, title, body, repeatMs, repeatMs);
        } else {
            cancel(context, id);
        }
    }

    static void schedule(Context context, String id, String title, String body, long delayMs, long repeatMs) {
        long safeDelayMs = Math.max(1000L, delayMs);
        long triggerAtWall = System.currentTimeMillis() + safeDelayMs;
        persistSchedule(context, id, title, body, safeDelayMs, repeatMs, triggerAtWall);
        scheduleAlarm(context, id, title, body, safeDelayMs, repeatMs);
    }

    static void restoreScheduled(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_SCHEDULES, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (!entry.getKey().startsWith(KEY_PREFIX) || !(entry.getValue() instanceof String)) continue;
            try {
                JSONObject obj = new JSONObject((String) entry.getValue());
                String id = obj.optString("id", "naonao");
                String title = obj.optString("title", "");
                String body = obj.optString("body", "");
                long repeatMs = Math.max(0L, obj.optLong("repeatMs", 0L));
                long triggerAtWall = obj.optLong("triggerAtWall", now + Math.max(1000L, obj.optLong("delayMs", 1000L)));
                if (triggerAtWall <= now && repeatMs <= 0L) {
                    prefs.edit().remove(entry.getKey()).apply();
                    continue;
                }
                long delayMs = triggerAtWall > now ? triggerAtWall - now : repeatMs;
                delayMs = Math.max(1000L, delayMs);
                scheduleAlarm(context, id, title, body, delayMs, repeatMs);
            } catch (Exception ignored) {}
        }
    }

    static void cancel(Context context, String id) {
        context.getSharedPreferences(PREF_SCHEDULES, Context.MODE_PRIVATE)
                .edit()
                .remove(scheduleKey(id))
                .apply();
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        manager.cancel(pendingIntent(context, id, "", "", 0L));
    }

    static void cancelAll(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_SCHEDULES, Context.MODE_PRIVATE);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (!entry.getKey().startsWith(KEY_PREFIX) || !(entry.getValue() instanceof String)) continue;
            try {
                JSONObject obj = new JSONObject((String) entry.getValue());
                String id = obj.optString("id", "naonao");
                if (manager != null) {
                    manager.cancel(pendingIntent(context, id, "", "", 0L));
                }
            } catch (Exception ignored) {}
        }
        prefs.edit().clear().apply();
    }

    private static void scheduleAlarm(Context context, String id, String title, String body, long delayMs, long repeatMs) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        PendingIntent pending = pendingIntent(context, id, title, body, repeatMs);
        long triggerAt = SystemClock.elapsedRealtime() + Math.max(1000L, delayMs);
        if (Build.VERSION.SDK_INT >= 23) {
            manager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        } else {
            manager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending);
        }
    }

    private static void persistSchedule(Context context, String id, String title, String body, long delayMs, long repeatMs, long triggerAtWall) {
        try {
            JSONObject obj = new JSONObject()
                    .put("id", id == null ? "naonao" : id)
                    .put("title", title == null ? "" : title)
                    .put("body", body == null ? "" : body)
                    .put("delayMs", Math.max(1000L, delayMs))
                    .put("repeatMs", Math.max(0L, repeatMs))
                    .put("triggerAtWall", triggerAtWall);
            context.getSharedPreferences(PREF_SCHEDULES, Context.MODE_PRIVATE)
                    .edit()
                    .putString(scheduleKey(id), obj.toString())
                    .apply();
        } catch (Exception ignored) {}
    }

    static void showNotification(Context context, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        ensureChannel(manager);

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) {
            launch = new Intent(context, MainActivity.class);
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                7,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );

        android.app.Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new android.app.Notification.Builder(context, CHANNEL_ID)
                : new android.app.Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(emptyToDefault(title, "孬孬提醒"))
                .setContentText(emptyToDefault(body, "回来看看当前任务。"))
                .setStyle(new android.app.Notification.BigTextStyle().bigText(emptyToDefault(body, "回来看看当前任务。")))
                .setAutoCancel(true)
                .setContentIntent(contentIntent);
        if (Build.VERSION.SDK_INT >= 21) {
            builder.setColor(0xff2f5f5a);
        }
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
    }

    private static PendingIntent pendingIntent(Context context, String id, String title, String body, long repeatMs) {
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ACTION_REMINDER);
        intent.putExtra("id", id == null ? "naonao" : id);
        intent.putExtra("title", title == null ? "" : title);
        intent.putExtra("body", body == null ? "" : body);
        intent.putExtra("repeatMs", repeatMs);
        int requestCode = (id == null ? "naonao" : id).hashCode();
        return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag()
        );
    }

    private static String scheduleKey(String id) {
        String value = id == null || id.trim().isEmpty() ? "naonao" : id;
        return KEY_PREFIX + value.replaceAll("[^A-Za-z0-9_.:-]", "_");
    }

    private static void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "孬孬专注提醒",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("番茄钟、长远任务和飞书监督提醒");
        manager.createNotificationChannel(channel);
    }

    private static int immutableFlag() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static String emptyToDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
