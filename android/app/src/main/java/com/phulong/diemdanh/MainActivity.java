package com.phulong.diemdanh;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Âm thanh tùy chỉnh từ res/raw/notification_sound.mp3
            Uri soundUri = Uri.parse(
                "android.resource://" + getPackageName() + "/" + R.raw.notification_sound
            );

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();

            NotificationChannel channel = new NotificationChannel(
                "attendance-reminders",              // channelId - phải trùng với FCM message
                "Nhắc nhở điểm danh",               // tên hiển thị cho người dùng
                NotificationManager.IMPORTANCE_HIGH  // ưu tiên cao → hiện banner + âm thanh
            );
            channel.setDescription("Thông báo nhắc nhở giờ điểm danh của trường THCS Phú Long");
            channel.setSound(soundUri, audioAttributes);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 300, 200, 300});

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}

