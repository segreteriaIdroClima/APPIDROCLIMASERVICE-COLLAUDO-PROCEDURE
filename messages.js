'use strict';
(()=>{
  let dialog,current=null,queue=[],sequence=0;
  function ensure(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='ics-message';dialog.setAttribute('aria-labelledby','ics-message-title');dialog.setAttribute('aria-describedby','ics-message-text');
    dialog.innerHTML='<div class="ics-message-brand"><img alt="" width="38" height="38"><span>IDROCLIMA SERVICE</span></div><h2 id="ics-message-title"></h2><p id="ics-message-text"></p><div class="ics-message-actions"><button type="button" data-message="cancel">Annulla</button><button type="button" data-message="accept">Ho capito</button></div>';
    const image=dialog.querySelector('img');image.src=window.IDROCLIMA_MESSAGE_LOGO||'idroclima-drop-48.png';image.onerror=()=>image.hidden=true;
    document.body.append(dialog);
    dialog.querySelector('[data-message="cancel"]').onclick=()=>finish(false);
    dialog.querySelector('[data-message="accept"]').onclick=()=>finish(true);
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
    dialog.addEventListener('close',()=>{if(current&&!dialog.open)finish(false);});
  }
  function drain(){
    if(current||!queue.length)return;ensure();current=queue.shift();current.focus=document.activeElement;
    dialog.querySelector('h2').textContent=current.title|| (current.confirm?'Conferma operazione':'Idroclima Service');
    dialog.querySelector('p').textContent=String(current.message||'');
    const cancel=dialog.querySelector('[data-message="cancel"]'),accept=dialog.querySelector('[data-message="accept"]');
    cancel.hidden=!current.confirm;cancel.textContent=current.cancelLabel||'Annulla';accept.textContent=current.acceptLabel||(current.confirm?'Conferma':'Ho capito');accept.classList.toggle('ics-message-danger',!!current.destructive);
    dialog.showModal();(current.confirm?cancel:accept).focus();
  }
  function finish(value){if(!current)return;const item=current;current=null;if(dialog.open)dialog.close();item.resolve(value);if(item.focus?.isConnected)item.focus.focus();queueMicrotask(drain);}
  function ask(message,options={}){return new Promise(resolve=>{queue.push({...options,message,resolve,id:++sequence});drain();});}
  window.IdroclimaMessages={alert:(message,options={})=>ask(message,{...options,confirm:false}),confirm:(message,options={})=>ask(message,{...options,confirm:true}),cancelAll(){const waiting=queue;queue=[];waiting.forEach(x=>x.resolve(false));finish(false);}};
})();
