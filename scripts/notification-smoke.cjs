const {app,Notification}=require('electron');
app.setName('Laputa');
app.whenReady().then(()=>{
 if(!Notification.isSupported())throw new Error('Native notifications are unsupported');
 const notification=new Notification({title:'Laputa · 通知验证',body:'任务完成通知已接入系统。',silent:true});
 const timeout=setTimeout(()=>{console.error('Native notification did not emit show');app.exit(1);},10000);
 notification.once('failed',(_event,error)=>{clearTimeout(timeout);console.error(error);app.exit(1);});
 notification.once('show',()=>{clearTimeout(timeout);console.log('Native notification show event received');setTimeout(()=>{notification.close();app.exit(0);},1500);});
 notification.show();
}).catch(error=>{console.error(error);app.exit(1);});
