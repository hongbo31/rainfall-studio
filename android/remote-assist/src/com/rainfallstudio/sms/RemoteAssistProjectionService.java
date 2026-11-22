package com.rainfallstudio.sms;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.WindowManager;

import java.nio.ByteBuffer;

import static com.rainfallstudio.sms.RemoteAssistTransport.NETWORK;

public final class RemoteAssistProjectionService extends Service {
    static final String SESSION = "session";
    static final String GRANT = "projection_grant";
    private static final String CHANNEL = "rainfall_remote_assist";
    private static final String STOP = "com.rainfallstudio.sms.STOP_REMOTE_ASSIST";
    private static final int NOTIFICATION_ID = 24;
    static volatile boolean sharing;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timer = this::sendFrame;
    private final Object frameLock = new Object();
    private final BroadcastReceiver screenOff = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent event) {
            if (Intent.ACTION_SCREEN_OFF.equals(event.getAction())) finishSession();
        }
    };
    private volatile RemoteAssistTransport transport;
    private volatile boolean closed;
    private volatile boolean active;
    private volatile boolean visible;
    private volatile String jpeg;
    private long lastCaptureAt;
    private long activeAt;
    private boolean receiverRegistered;
    private boolean seen;
    private int sequence;
    private RemoteAssistTransport.Session request;
    private HandlerThread captureThread;
    private Handler capture;
    private MediaProjection projection;
    private VirtualDisplay display;
    private volatile ImageReader reader;

    private final MediaProjection.Callback projectionEvents = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            finishSession();
        }

        @Override
        public void onCapturedContentVisibilityChanged(boolean isVisible) {
            synchronized (frameLock) {
                visible = isVisible;
                if (!isVisible) jpeg = null;
            }
            if (!isVisible && seen) finishSession();
            if (isVisible) sampleLatest();
            seen = seen || isVisible;
        }

        @Override
        public void onCapturedContentResize(int width, int height) {
            if (closed || display == null || width <= 0 || height <= 0) return;
            try {
                replaceReader(RemoteAssistFrames.fit(width, height));
            } catch (RuntimeException failure) {
                finishSession();
            }
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction()) || Build.VERSION.SDK_INT < 34) {
            finishSession();
            return START_NOT_STICKY;
        }
        if (sharing) return START_NOT_STICKY;
        try {
            request = new RemoteAssistTransport.Session(intent.getStringExtra(SESSION), "view", "pending");
            Intent grant = intent.getParcelableExtra(GRANT, Intent.class);
            if (grant == null || !notificationsEnabled(this) || isLocked()) throw new IllegalStateException();
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            sharing = true;
            registerReceiver(screenOff, new IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED);
            receiverRegistered = true;
            startProjection(grant);
            acceptSession();
        } catch (RuntimeException error) {
            finishSession();
        }
        return START_NOT_STICKY;
    }

    private void startProjection(Intent grant) {
        captureThread = new HandlerThread("rainfall-assist-capture");
        captureThread.start();
        capture = new Handler(captureThread.getLooper());
        Rect bounds = getSystemService(WindowManager.class).getMaximumWindowMetrics().getBounds();
        RemoteAssistFrames.Dimensions size = RemoteAssistFrames.fit(bounds.width(), bounds.height());
        reader = openReader(size);
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        projection = manager.getMediaProjection(Activity.RESULT_OK, grant);
        if (projection == null) throw new IllegalStateException("ASSIST_PROJECTION_NOT_GRANTED");
        projection.registerCallback(projectionEvents, main);
        display = projection.createVirtualDisplay("Rainfall 远程协助", size.width, size.height,
                getResources().getDisplayMetrics().densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.getSurface(), null, main);
        if (display == null) throw new IllegalStateException("ASSIST_PROJECTION_NOT_AVAILABLE");
    }

    private ImageReader openReader(RemoteAssistFrames.Dimensions size) {
        ImageReader next = ImageReader.newInstance(size.width, size.height, PixelFormat.RGBA_8888, 2);
        next.setOnImageAvailableListener(this::sample, capture);
        return next;
    }

    private void replaceReader(RemoteAssistFrames.Dimensions size) {
        ImageReader previous = reader;
        if (previous != null && previous.getWidth() == size.width && previous.getHeight() == size.height) return;
        ImageReader next = openReader(size);
        synchronized (frameLock) {
            reader = next;
            jpeg = null;
        }
        try {
            display.resize(size.width, size.height, getResources().getDisplayMetrics().densityDpi);
            display.setSurface(next.getSurface());
        } finally {
            if (previous != null) previous.close();
        }
    }

    private void acceptSession() {
        RemoteAssistTransport.Session candidate = request;
        NETWORK.execute(() -> {
            try {
                if (closed) return;
                RemoteAssistTransport connection = new RemoteAssistTransport(getApplicationContext());
                transport = connection;
                if (closed || !connection.accept(candidate)) {
                    main.post(this::finishSession);
                    return;
                }
                if (closed) {
                    connection.stop(candidate);
                    return;
                }
                main.post(() -> {
                    if (closed) return;
                    active = true;
                    activeAt = SystemClock.elapsedRealtime();
                    main.postDelayed(this::finishSession, RemoteAssistTransport.SESSION_LIMIT_MS);
                    sampleLatest();
                    sendFrame();
                });
            } catch (Exception failure) {
                main.post(this::finishSession);
            }
        });
    }

    private void sample(ImageReader source) {
        // Keep the initial image available until both ends approve and Android reports visibility.
        if (source != reader || !canShare()) return;
        try (Image image = source.acquireLatestImage()) {
            long now = SystemClock.elapsedRealtime();
            if (image == null || source != reader || !canShare()
                    || now - lastCaptureAt < RemoteAssistFrames.INTERVAL_MS) return;
            lastCaptureAt = now;
            Bitmap bitmap = toBitmap(image);
            try {
                String encoded = RemoteAssistFrames.jpeg(bitmap);
                synchronized (frameLock) {
                    if (source == reader && canShare()) jpeg = encoded;
                }
            } finally {
                bitmap.recycle();
            }
        } catch (Exception failure) {
            if (!closed && source == reader) main.post(this::finishSession);
        }
    }

    private void sampleLatest() {
        ImageReader current = reader;
        if (current != null && capture != null && canShare()) capture.post(() -> sample(current));
    }

    private static Bitmap toBitmap(Image image) {
        int width = image.getWidth();
        int height = image.getHeight();
        Image.Plane plane = image.getPlanes()[0];
        int rowStride = plane.getRowStride();
        int pixelStride = plane.getPixelStride();
        ByteBuffer pixels = plane.getBuffer();
        int start = pixels.position();
        int[] rgb = new int[width * height];
        for (int y = 0; y < height; y++) {
            int row = start + y * rowStride;
            for (int x = 0; x < width; x++) {
                int base = row + x * pixelStride;
                int red = pixels.get(base) & 255;
                int green = pixels.get(base + 1) & 255;
                int blue = pixels.get(base + 2) & 255;
                rgb[y * width + x] = 0xff000000 | (red << 16) | (green << 8) | blue;
            }
        }
        return Bitmap.createBitmap(rgb, width, height, Bitmap.Config.ARGB_8888);
    }

    private void sendFrame() {
        if (closed) return;
        if (isLocked() || !notificationsEnabled(this) || PairingStore.displayName(this).isEmpty()) {
            finishSession();
            return;
        }
        long started = SystemClock.elapsedRealtime();
        if (sequence == 0 && jpeg == null && started - activeAt >= 12_000) {
            finishSession();
            return;
        }
        RemoteAssistTransport.Session session = request;
        RemoteAssistTransport connection = transport;
        NETWORK.execute(() -> {
            try {
                if (closed) return;
                String frame = canShare() ? jpeg : null;
                if (frame != null && canShare()) connection.send(session, ++sequence, frame);
                else if (!session.isActive(connection.poll())) {
                    main.post(this::finishSession);
                    return;
                }
                long interval = frame == null ? 900 : RemoteAssistFrames.INTERVAL_MS;
                main.post(() -> {
                    if (!closed) main.postDelayed(timer, Math.max(0L,
                            started + interval - SystemClock.elapsedRealtime()));
                });
            } catch (Exception failure) {
                main.post(this::finishSession);
            }
        });
    }

    private boolean isLocked() {
        return !getSystemService(PowerManager.class).isInteractive()
                || getSystemService(KeyguardManager.class).isKeyguardLocked();
    }

    private boolean canShare() {
        return active && visible && !closed && !isLocked();
    }

    private void finishSession() {
        releaseSession();
        stopSelf();
    }

    private void releaseSession() {
        if (closed) return;
        synchronized (frameLock) {
            closed = true;
            active = false;
            jpeg = null;
        }
        sharing = false;
        main.removeCallbacksAndMessages(null);
        if (receiverRegistered) unregisterReceiver(screenOff);
        if (display != null) display.release();
        ImageReader frames = reader;
        reader = null;
        if (frames != null) frames.close();
        if (projection != null) {
            projection.unregisterCallback(projectionEvents);
            projection.stop();
        }
        if (captureThread != null) captureThread.quitSafely();
        stopForeground(STOP_FOREGROUND_REMOVE);
        RemoteAssistTransport connection = transport;
        RemoteAssistTransport.Session candidate = request;
        if (connection != null && candidate != null) NETWORK.execute(() -> connection.stop(candidate));
    }

    @Override
    public void onDestroy() {
        releaseSession();
        super.onDestroy();
    }

    static void createChannel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "远程协助", NotificationManager.IMPORTANCE_LOW);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    static boolean notificationsEnabled(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return manager.areNotificationsEnabled() && channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private Notification notification() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent open = PendingIntent.getActivity(this, NOTIFICATION_ID,
                new Intent(this, RemoteAssistActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), flags);
        PendingIntent stop = PendingIntent.getService(this, NOTIFICATION_ID,
                new Intent(this, RemoteAssistProjectionService.class).setAction(STOP), flags);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_sms)
                .setContentTitle("Rainfall 正在共享画面")
                .setContentText("电脑仅查看画面")
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setOngoing(true)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "停止共享", stop).build())
                .build();
    }
}
