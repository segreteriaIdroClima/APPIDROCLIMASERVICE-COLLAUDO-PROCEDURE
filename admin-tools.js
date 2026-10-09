// Admin helpers: rendering/filtering never changes stored permissions.
let adminDirty = false;
const adminYes = value => ['TRUE','VERO','SI','SÌ','1'].includes(String(value).toUpperCase());
const adminEscape = value => String(value == null ? '' : value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setAdminDirty(value) {
    adminDirty = value;
    const label = document.getElementById('admin-save-state');
    if (label) {label.textContent = value ? 'Modifiche da salvare' : 'Tutte le modifiche salvate';label.classList.toggle('pending',value);}
}
function adminUnique(prefix,items,key) {let i=1;while(items.some(v=>String(v[key]).toUpperCase()===prefix+i))i++;return prefix+i;}
function openNewAdminCard(id) {
    const toolbar=document.getElementById(id+'-search');
    toolbar.querySelector('input').value='';
    const filter=toolbar.querySelector('select');if(filter)filter.value='';
    filterAdminCards(id);
    const cards=document.getElementById(id).querySelectorAll('details');
    const card=cards[cards.length-1];if(card){card.open=true;card.scrollIntoView({block:'nearest'});card.querySelector('input:not([readonly])')?.focus();}
}
function adminUserExtras(u,i) {
    const toggle = (field,label,help) => `<div class="admin-toggle-row"><span>${label}<small>${help}</small></span><label class="toggle-switch"><input type="checkbox" aria-label="${label}" class="u-toggle" data-idx="${i}" data-field="${field}" ${adminYes(u[field])?'checked':''}><span class="slider"></span></label></div>`;
    const last = u.ULTIMA_TIMBRATURA ? new Date(isNaN(Number(u.ULTIMA_TIMBRATURA)) ? u.ULTIMA_TIMBRATURA : Number(u.ULTIMA_TIMBRATURA)).toLocaleString('it-IT') : 'Nessuna registrata';
    return toggle('ESCLUSO_CONTEGGI','Escludi dalle timbrature e dai conteggi','Non compare negli elenchi presenze e nel file ore; accede senza obbligo di timbratura. Impostazione condivisa con il personale.') + toggle('ESENTE_TIMBRATURA','Accesso senza obbligo di timbratura','Evita la sospensione dopo 7 giorni. Non modifica i conteggi delle presenze.') + toggle('CAN_EDIT_PROCEDURE','Può modificare le procedure','Delega la gestione delle procedure a questo utente.') + `<p class="admin-hint">Ultima timbratura: ${adminEscape(last)}</p>`;
}
function compactAdminCards(id) {
    const container=document.getElementById(id);
    if(!container)return;
    let toolbar=document.getElementById(id+'-search');
    if(!toolbar){
        toolbar=document.createElement('div');toolbar.id=id+'-search';toolbar.className='admin-search-bar';
        toolbar.innerHTML='<input type="search" placeholder="Cerca…" aria-label="Cerca nelle schede"><span class="admin-count"></span>';
        if(id==='utenti-container')toolbar.innerHTML+='<select aria-label="Filtra utenti"><option value="">Tutti gli utenti</option><option value="active">Accesso attivo</option><option value="paused">Sospesi per timbrature</option><option value="disabled">Accesso disattivato</option><option value="exempt">Esenti timbrature</option></select>';
        container.before(toolbar);
        toolbar.addEventListener('input',()=>filterAdminCards(id));toolbar.addEventListener('change',()=>filterAdminCards(id));
    }
    [...container.children].forEach((card,i)=>{
        const header=card.querySelector('.admin-card-header');if(!header)return;
        const details=document.createElement('details');details.className='admin-card admin-fold';
        const summary=document.createElement('summary');summary.className='admin-card-header';
        const title=header.querySelector('span');if(title)summary.appendChild(title);
        details.appendChild(summary);
        const body=card.querySelector('.admin-card-body');if(body){
            const actions=[...header.querySelectorAll('button')];
            if(actions.length){const row=document.createElement('div');row.className='admin-actions';actions.forEach(button=>row.appendChild(button));body.appendChild(row);}
            details.appendChild(body);
        }
        // Search excludes passwords and exposes the user name, ID, username and group.
        const user=id==='utenti-container' ? adminData.utenti[i] : null;
        const app=id==='admin-apps-container' ? adminData.apps[i] : null;
        details.dataset.search=(user ? [user.NOME,user.ID_UTENTE,user.USERNAME,user.PROFILO] : app ? [app.NOME_APP,app.ID_APP,app.LINK_DEPLOYMENT] : [summary.textContent]).join(' ').toLocaleLowerCase('it');
        if(user){details.dataset.active=adminYes(user.ATTIVO);details.dataset.paused=adminYes(user.SOSPESO_INATTIVITA);details.dataset.exempt=adminYes(user.ESENTE_TIMBRATURA)||adminYes(user.ESCLUSO_CONTEGGI);}
        const labels={ID_UTENTE:'ID utente',NOME:'Nome dipendente',USERNAME:'Username',PASSWORD_HASH:'Password',PROFILO:'Gruppo di permessi',ATTIVO:'Presente nell’organico attivo',ID_APP:'ID app',NOME_APP:'Nome app',LINK_DEPLOYMENT:'Indirizzo app',ICONA:'Icona',ORDINE:'Ordine',ATTIVA:'App attiva',VISIBILE_HOME:'Visibile in homepage',ID_PROFILO:'Nome gruppo',DESCRIZIONE:'Descrizione'};
        details.querySelectorAll('[data-field]').forEach(input=>{if(labels[input.dataset.field])input.setAttribute('aria-label',labels[input.dataset.field]);});
        card.replaceWith(details);
    });
    filterAdminCards(id);
}
function filterAdminCards(id) {
    const toolbar=document.getElementById(id+'-search'),container=document.getElementById(id);if(!toolbar||!container)return;
    const query=toolbar.querySelector('input').value.trim().toLocaleLowerCase('it'),type=toolbar.querySelector('select')?.value||'';
    let shown=0,total=0;
    container.querySelectorAll('.admin-fold').forEach(card=>{
        total++;
        const matches=!type || type==='active'&&card.dataset.active==='true' || type==='paused'&&card.dataset.paused==='true' || type==='disabled'&&card.dataset.active!=='true' || type==='exempt'&&card.dataset.exempt==='true';
        card.hidden=!card.dataset.search.includes(query)||!matches;if(!card.hidden)shown++;
    });
    toolbar.querySelector('.admin-count').textContent=shown+' / '+total;
    let empty=container.querySelector('.admin-empty');if(!empty){empty=document.createElement('p');empty.className='admin-empty';container.appendChild(empty);}
    empty.textContent='Nessun risultato.';empty.hidden=shown>0;
}
function buildAdminPermissions(data,changes) {
    const result=[];
    data.utenti.forEach(u=>data.apps.forEach(a=>{
        const old=data.permessi.find(p=>p.ID_UTENTE===u.ID_UTENTE&&p.ID_APP===a.ID_APP);
        const changed=changes[u.PROFILO]?.[a.ID_APP];
        if(changed!==undefined || old)result.push({ID_UTENTE:u.ID_UTENTE,ID_APP:a.ID_APP,ABILITATO:changed===undefined?adminYes(old.ABILITATO):changed});
    }));
    return result;
}
function validateAdminData() {
    for(const [items,key,label] of [[adminData.utenti,'ID_UTENTE','ID utente'],[adminData.utenti,'USERNAME','Username'],[adminData.apps,'ID_APP','ID app'],[adminData.profili,'ID_PROFILO','Gruppo']]){
        const values=items.map(v=>String(v[key]||'').trim().toUpperCase());
        if(values.some(v=>!v)||new Set(values).size!==values.length)return label+': compila tutti i valori ed elimina i duplicati.';
    }
    if(adminData.utenti.some(u=>!String(u.NOME||'').trim()||!String(u.PASSWORD_HASH||'').trim()))return 'Ogni utente deve avere nome, username e password.';
    if(adminData.utenti.some(u=>!adminData.profili.some(g=>g.ID_PROFILO===u.PROFILO)))return 'Assegna a ogni utente un gruppo esistente.';
    return '';
}
document.addEventListener('DOMContentLoaded',()=>{
    const screen=document.getElementById('admin-screen');
    screen.addEventListener('input',e=>{if(e.target.type!=='search'&&e.target.closest('.admin-card'))setAdminDirty(true);});
    screen.addEventListener('change',e=>{if(e.target.type!=='search'&&e.target.closest('.admin-card'))setAdminDirty(true);});
    document.getElementById('admin-collapse').addEventListener('click',()=>screen.querySelectorAll('details').forEach(d=>d.open=false));
    document.getElementById('admin-reload').addEventListener('click',()=>{if(!adminDirty||confirm('Ricaricare e scartare le modifiche non salvate?'))loadAdminData();});
    window.addEventListener('beforeunload',e=>{if(adminDirty){e.preventDefault();e.returnValue='';}});
});
