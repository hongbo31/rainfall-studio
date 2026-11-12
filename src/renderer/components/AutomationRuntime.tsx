import React,{useEffect,useState} from 'react';
import {useStudio} from '../context';
export default function AutomationRuntime(){
 const {call}=useStudio();const [value,setValue]=useState({backgroundEnabled:false,loginAtStartup:false}),[message,setMessage]=useState('');
 useEffect(()=>{void call('runtime.settings').then(setValue).catch(()=>{})},[]);
 return <details className="panel"><summary>后台运行设置</summary><label className="check"><input type="checkbox" checked={value.backgroundEnabled} onChange={e=>setValue({...value,backgroundEnabled:e.target.checked})}/>关闭窗口后继续执行</label><label className="check"><input type="checkbox" checked={value.loginAtStartup} onChange={e=>setValue({...value,loginAtStartup:e.target.checked})}/>登录 Windows 后启动</label><small>电脑需开机、联网；关机或休眠期间不执行。</small><div><button onClick={async()=>{try{setValue(await call('runtime.configure',value));setMessage('已保存')}catch(e:any){setMessage(e.message)}}}>保存</button><span role="status">{message}</span></div></details>;
}
