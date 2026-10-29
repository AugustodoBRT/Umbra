package io.cinessd.android;
import android.app.*;
import android.content.Intent;
import android.os.*;
import androidx.core.app.NotificationCompat;
public class TransferService extends Service {
    static TransferService active;
    @Override public void onCreate() { super.onCreate(); active=this; NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE); if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("downloads","Downloads do Umbra",NotificationManager.IMPORTANCE_LOW)); startForeground(10,new NotificationCompat.Builder(this,"downloads").setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("Umbra").setContentText("Preparando downloads…").setOngoing(true).build()); }
    void update(String title,long done,long total) { NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE); manager.notify(10,new NotificationCompat.Builder(this,"downloads").setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle(title).setContentText(total>0 ? (done*100/total)+"%" : "Buscando dados da fonte…").setProgress(100,total>0?(int)(done*100/total):0,total<=0).setOngoing(true).build()); }
    @Override public int onStartCommand(Intent intent,int flags,int startId) { return START_NOT_STICKY; }
    @Override public void onDestroy() { active=null; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onTimeout(int startId,int type) { Transfers.get(this).pauseAll(); stopSelf(); }
}
