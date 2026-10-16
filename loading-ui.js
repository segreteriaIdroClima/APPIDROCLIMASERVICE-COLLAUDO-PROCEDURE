'use strict';
(() => {
  // Solo presentazione: nessuna richiesta, timer di attesa, modifica a dati o controlli.
  const source=document.currentScript?.dataset.logo||'idroclima-drop-180.png';
  document.documentElement.style.setProperty('--icl-logo','url("'+source+'")');
  function artwork(size=''){
    const node=document.createElement('span');node.className='icl-art'+(size?' icl-art--'+size:'');node.setAttribute('aria-hidden','true');
    node.innerHTML='<span class="icl-ring"></span><span class="icl-ring"></span><img alt="" src="'+source+'"><span class="icl-track"></span>';return node;
  }
  window.IdroclimaLoading={artwork};
  function initialize(){
    document.querySelectorAll('.loading-state,.loader-card').forEach(node=>{
      node.querySelectorAll('.fa-spin,.spinner').forEach(old=>old.replaceWith(artwork()));
      node.setAttribute('role','status');node.setAttribute('aria-live','polite');
    });
    const login=document.getElementById('login-spinner');if(login){const art=artwork('small');login.classList.remove('fa-solid','fa-spinner','fa-spin');login.classList.add('icl-art','icl-art--small');login.innerHTML=art.innerHTML;login.setAttribute('role','status');login.setAttribute('aria-label','Accesso in corso');}
    const busyText=/^(?:[📤⏳\s]*)(?:caricamento|invio\s+in\s+corso|invio[.…]|salvataggio|ricerca\s+(?:delle|in)|verifica\s+della\s+targa|preparazione\s+dati)/i;
    const statusSelector='#pillStatus,#recEsito,#uffEsito,#perEsito,#attEsito,#perMailStatus,#attMailStatus,#pausaStatus,#tsPayResult,#curitScanResult,#nativeFormStatus,.nativeUploadMeta,.nativeUploadStatus,.nativeMunicipalityHint,.nativeField .hint,.idp39 p';
    function paint(){
      document.querySelectorAll(statusSelector).forEach(node=>{const busy=busyText.test(node.textContent.trim());if(node.classList.contains('icl-busy')!==busy)node.classList.toggle('icl-busy',busy);});
      document.querySelectorAll('button:disabled,button.icl-busy').forEach(node=>{
        const requestButton=['btnLoad','btnSendRecensione','btnInviaTsPayEmail','btnSendRichiestaUfficio','btn-admin-save','btn-save-keywords'].includes(node.id);
        const busy=node.disabled && (requestButton||/invio|salvataggio|caricamento/i.test(node.textContent)) && !node.querySelector('.icl-art');
        if(node.classList.contains('icl-busy')!==busy)node.classList.toggle('icl-busy',busy);
      });
      document.querySelectorAll('select').forEach(node=>{
        const busy=/^Caricamento\b/i.test(node.options[0]?.textContent.trim()||'');
        let wait=node.nextElementSibling;if(!wait?.classList.contains('icl-select-wait'))wait=null;
        if(busy&&!wait){wait=document.createElement('span');wait.className='icl-select-wait';wait.setAttribute('aria-hidden','true');wait.append(artwork('small'));node.after(wait);}
        if(wait&&wait.hidden===busy)wait.hidden=!busy;
      });
      const title=document.getElementById('nativeOutcomeTitle');if(title){
        let art=document.getElementById('icl-outcome');const busy=/^INVIO IN CORSO$/i.test(title.textContent.trim());
        if(busy&&!art){art=document.createElement('div');art.id='icl-outcome';art.className='icl-outcome-art';art.append(artwork());title.before(art);}
        if(art&&art.hidden===busy)art.hidden=!busy;
      }
    }
    let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;paint();});});
    paint();observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','class']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
