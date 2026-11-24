const shops = [
  {id:'burger',name:'Burger District',category:'Burgers',detail:'Smash burgers · American',rating:4.8,time:25,tag:'Popular',icon:'🍔',menu:[['Classic Smash',249],['Double Stack',349],['Truffle Fries',159]]},
  {id:'pizza',name:'The Pizza Room',category:'Pizza',detail:'Wood-fired pizza · Italian',rating:4.9,time:30,tag:'Top rated',icon:'🍕',menu:[['Margherita',299],['Hot Honey Pepperoni',399],['Garlic Knots',149]]},
  {id:'sushi',name:'Maki & Co.',category:'Sushi',detail:'Sushi rolls · Japanese',rating:4.7,time:35,tag:'',icon:'🍣',menu:[['Salmon Maki',389],['Avocado Roll',269],['Edamame',169]]},
  {id:'salad',name:'The Green Bowl',category:'Healthy',detail:'Salads · Grain bowls',rating:4.8,time:20,tag:'',icon:'🥗',menu:[['Harvest Bowl',279],['Crispy Tofu Salad',269],['Lemonade',99]]},
  {id:'dessert',name:'Sugar Studio',category:'Desserts',detail:'Cakes · Pastries',rating:4.6,time:28,tag:'',icon:'🍰',menu:[['Chocolate Tart',199],['Berry Cheesecake',239],['Brownie',139]]}
];
const config = window.CRAVE_CONFIG;
const apiUrl = config.apiUrl.trim().replace(/\/$/, '');
const role = () => config.role;
const accessKey = 'crave.access.' + role();
let credentials = sessionStorage.getItem(accessKey) || '';
let client = localStorage.getItem('crave.client');
if (apiUrl && !client) {
  client = crypto.randomUUID();
  localStorage.setItem('crave.client',client);
}
let remote = {orders:[],paused:[]};
let syncError = '';
let requestPending = false;
const stages = ['Placed','Preparing','Ready for pickup','Out for delivery','Delivered'];
const key = 'crave.food.v1';
const defaults = {orders:[],bag:{},favorites:[],paused:[],address:'Indiranagar, Bengaluru',outlet:'burger'};
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let category = 'All';
let query = '';
let sort = 'Recommended';
let toastTimer;
let openShop = null;
const money = value => '₹' + value.toLocaleString('en-IN');
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localData = () => ({...defaults,...JSON.parse(localStorage.getItem(key) || '{}')});
const store = () => ({...localData(),...(apiUrl ? remote : {})});
const update = fn => {const data=localData();fn(data);localStorage.setItem(key,JSON.stringify(data));render();};

const restaurant = id => shops.find(shop=>shop.id===id);
const bagItems = data => Object.entries(data.bag).map(([id,qty])=>{
  const [shop,index]=id.split(':');
  const [name,price]=restaurant(shop).menu[Number(index)];
  return {id,shop,name,price,qty};
});
const total = items => items.reduce((sum,item)=>sum+item.price*item.qty,0);
const orders = data => [...data.orders].reverse();
function notify(message){
  const toast=document.querySelector('#toast');
  toast.textContent=message;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.textContent='',2800);
}
function storefront(data){
  return `<section class="hero"><img src="img/burger.jpg" alt=""><div class="hero-copy"><span class="eyebrow">Bengaluru eats</span><h1>Good food.<br><em>Better mood.</em></h1><p>Discover local favorites, delivered to your door.</p><button class="primary" data-action="browse">Explore restaurants</button></div></section>
  <div class="tools"><label class="search"><span aria-hidden="true">⌕</span><input id="search" aria-label="Search restaurants or dishes" placeholder="Search restaurants or dishes" value="${escape(query)}"></label><select id="sort" aria-label="Sort restaurants">${['Recommended','Top rated','Fastest'].map(option=>`<option ${sort===option?'selected':''}>${option}</option>`).join('')}</select></div>
  <div class="categories" aria-label="Food categories">${[['All','🍽️'],...shops.map(s=>[s.category,s.icon]),['Favorites','♡']].map(([name,icon])=>`<button class="chip ${category===name?'active':''}" aria-pressed="${category===name}" data-category="${name}">${icon} &nbsp;${name}</button>`).join('')}</div>
  <div class="section-head" id="restaurants"><div><h2>Restaurants near you</h2><p id="result-count"></p></div><button class="secondary" data-action="orders">My orders ${data.orders.length?'('+data.orders.length+')':''}</button></div><div class="grid" id="results"></div>`;
}
function fillResults(data){
  const visible=shops.filter(s=>(category==='All'||category===s.category||(category==='Favorites'&&data.favorites.includes(s.id)))&&[s.name,s.detail,s.category,...s.menu.map(m=>m[0])].join(' ').toLowerCase().includes(query.toLowerCase().trim()));
  if(sort==='Top rated') visible.sort((a,b)=>b.rating-a.rating);
  if(sort==='Fastest') visible.sort((a,b)=>a.time-b.time);
  document.querySelector('#result-count').textContent=visible.length+' '+(visible.length===1?'restaurant':'restaurants');
  document.querySelector('#results').innerHTML=visible.length?visible.map(s=>`<article class="card"><img class="photo" src="img/${s.id}.jpg" alt=""><button class="favorite" aria-label="Favorite ${s.name}" aria-pressed="${data.favorites.includes(s.id)}" data-action="favorite" data-id="${s.id}">${data.favorites.includes(s.id)?'♥':'♡'}</button>${s.tag?`<span class="tag">${s.tag}</span>`:''}<div class="card-body"><div class="split"><h3>${s.name}</h3><span class="rating">★ ${s.rating}</span></div><p>${s.detail}</p><div class="split"><span class="muted">${data.paused.includes(s.id)?'Ordering paused':s.time+'–'+(s.time+10)+' min · ₹39 delivery'}</span><button class="secondary" data-action="menu" data-id="${s.id}">View menu</button></div></div></article>`).join(''):'<p class="empty">No restaurants match your filters.</p>';
}
function orderCard(order,view){
  const action = view==='outlet' ? ({0:'Accept order',1:'Mark ready'})[order.stage] : view==='courier' ? ({2:'Accept and pick up',3:'Mark delivered'})[order.stage] : null;
  return `<article class="order"><div class="split"><h3>${restaurant(order.shop).name} · #${order.id}</h3><span class="pill">${stages[order.stage]}</span></div><p>${order.items.map(item=>item.qty+' × '+item.name).join(', ')} · <strong>${money(order.total)}</strong></p><p class="muted">${escape(order.address)}</p>${view==='customer'?`<div class="timeline">${stages.map((s,i)=>`<span class="${i<=order.stage?'done':''}" ${i===order.stage?'aria-current="step"':''}>${s}</span>`).join('')}</div>`:''}${action?`<button class="primary" data-action="advance" data-id="${order.id}" data-stage="${order.stage}">${action}</button>`:''}</article>`;
}
function dashboard(data,view){
  const list=orders(data).filter(o=>view==='admin'||(view==='outlet'?o.shop===data.outlet:o.stage>=2));
  const [title,description,queue] = {courier:['Delivery workspace','Pick up ready orders and confirm doorstep delivery.','Delivery orders'],outlet:['Outlet workspace','Manage incoming orders and pause ordering for an outlet.','Outlet orders'],admin:['Admin workspace','Monitor orders, deliveries, and outlet availability.','All orders']}[view];
  return `<section class="dashboard"><h1>${title}</h1><p class="muted">${description}</p>
  ${view==='outlet'?`<div class="panel row"><label>Restaurant <select class="secondary" id="outlet-select">${shops.map(s=>`<option value="${s.id}" ${s.id===data.outlet?'selected':''}>${s.name}</option>`).join('')}</select></label><button class="secondary" data-action="toggle" data-id="${data.outlet}">${data.paused.includes(data.outlet)?'Resume orders':'Pause orders'}</button></div>`:''}
  <div class="stats"><div class="panel"><span class="muted">${view==='courier'?'Ready for pickup':'Active orders'}</span><strong>${list.filter(o=>view==='courier'?o.stage===2:o.stage<4).length}</strong></div><div class="panel"><span class="muted">Delivered</span><strong>${list.filter(o=>o.stage===4).length}</strong></div><div class="panel"><span class="muted">${view==='admin'?'Open outlets':'Order value'}</span><strong>${view==='admin'?shops.length-data.paused.length:money(list.reduce((sum,o)=>sum+o.total,0))}</strong></div></div>
  <div class="section-head"><h2>${queue}</h2></div>${list.length?list.map(o=>orderCard(o,view)).join(''):'<div class="empty">No orders here yet.</div>'}
  ${view==='admin'?`<div class="section-head"><h2>Outlets</h2></div>${shops.map(s=>`<div class="panel row"><div><h3>${s.name}</h3><p class="muted">${data.paused.includes(s.id)?'Paused':'Accepting orders'}</p></div><button class="secondary" data-action="toggle" data-id="${s.id}">${data.paused.includes(s.id)?'Resume':'Pause'}</button></div>`).join('')}`:''}</section>`;
}
async function sync(action){
  if(!apiUrl || requestPending || (role()!=='customer'&&!credentials))return false;
  requestPending=true;
  try{
    const response=await fetch(apiUrl+'/api/state',{
      method:action?'POST':'GET',
      headers:{'X-Crave-Role':role(),...(role()==='customer'?{'X-Crave-Client':client}:{Authorization:'Bearer '+credentials}),...(action?{'Content-Type':'application/json'}:{})},
      ...(action?{body:JSON.stringify(action)}:{})
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.error);
    const changed=syncError||JSON.stringify(remote)!==JSON.stringify(result);
    remote=result;
    syncError='';
    if(changed)render();
    return true;
  }catch(error){
    const previous=syncError;
    syncError=error.message;
    if(action)notify(syncError);
    if(previous!==syncError)render();
    return false;
  }finally{requestPending=false;}
}
function render(){
  const data=store(),view=role();
  document.querySelector('#location').textContent=data.address;
  document.querySelector('#count').textContent=bagItems(data).reduce((n,i)=>n+i.qty,0);
  document.querySelectorAll('[data-role]').forEach(button=>{
    button.classList.toggle('active',button.dataset.role===view);
    button.setAttribute('aria-pressed',String(button.dataset.role===view));
  });
  app.innerHTML=view==='customer'?storefront(data):dashboard(data,view);
  if(view==='customer')fillResults(data);
  if(!apiUrl){
    app.insertAdjacentHTML('afterbegin','<p class="connection">Browser demo. Set the shared API URL in config.js to connect the deployed apps.</p>');
  }else if(view!=='customer'){
    app.insertAdjacentHTML('afterbegin',`<form id="access-form" class="connection"><label>Workspace access key <input name="token" type="password" required autocomplete="off"></label><button class="secondary">Connect</button> ${credentials&&!syncError?'Connected':escape(syncError)}</form>`);
  }else if(syncError){
    app.insertAdjacentHTML('afterbegin',`<p class="connection">Order server: ${escape(syncError)}</p>`);
  }
}
function modal(title,contents){
  dialog.innerHTML=`<div class="split"><h2>${title}</h2><button class="close" aria-label="Close" data-action="close">×</button></div>${contents}`;
  if(!dialog.open)dialog.showModal();
}
function menu(id){
  openShop=id;
  const s=restaurant(id),data=store();
  modal(s.name,`<p class="muted">${s.detail}</p>${s.menu.map(([name,price],i)=>`<div class="row"><div><strong>${name}</strong><br><span class="muted">${money(price)}</span></div>${data.paused.includes(id)?'<span class="pill">Paused</span>':`<button class="secondary" data-action="add" data-id="${id}:${i}">Add</button>`}</div>`).join('')}<button class="primary" data-action="cart">View bag</button>`);
}
function cart(){
  const data=store(),items=bagItems(data);
  modal('Your bag',items.length?`${items.map(i=>`<div class="row"><div><strong>${i.name}</strong><br><span class="muted">${money(i.price)} · ${restaurant(i.shop).name}</span></div><div class="split"><button class="secondary" aria-label="Remove one ${i.name}" data-action="remove" data-id="${i.id}">−</button><b>${i.qty}</b><button class="secondary" aria-label="Add one ${i.name}" data-action="add" data-id="${i.id}">+</button></div></div>`).join('')}<p>Delivery · ${money(39)}</p><p><strong>Total · ${money(total(items)+39)}</strong></p><p class="muted">Demo checkout · Cash on delivery</p><button class="primary" data-action="checkout">Place order</button>`:'<p class="muted">Your bag is empty. Open a restaurant menu to add something.</p>');
}
function tracking(){
  const list=orders(store());
  modal('My orders',list.length?`<div class="outlet-list">${list.map(o=>orderCard(o,'customer')).join('')}</div>`:'<p class="muted">You haven’t placed an order yet.</p>');
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');
  if(!button)return;
  const {action,id,category:nextCategory,stage}=button.dataset;
  if(nextCategory){category=nextCategory;render();document.querySelector('[data-category][aria-pressed="true"]')?.focus();return;}
  switch(action){
    case 'browse':document.querySelector('#restaurants').scrollIntoView({behavior:'smooth'});break;
    case 'address':modal('Delivery address',`<form id="address-form"><label>Address or neighborhood<input name="address" required maxlength="120" value="${escape(store().address)}"></label><button class="primary">Save address</button></form>`);break;
    case 'favorite':update(data=>data.favorites=data.favorites.includes(id)?data.favorites.filter(s=>s!==id):[...data.favorites,id]);break;
    case 'menu':menu(id);break;
    case 'cart':openShop=null;cart();break;
    case 'close':dialog.close();break;
    case 'orders':tracking();break;
    case 'add': {
      const shop=id.split(':')[0],data=store();
      if(data.paused.includes(shop)){notify('This outlet has paused ordering.');break;}
      if(Object.keys(data.bag).some(item=>!item.startsWith(shop+':'))){notify('Place or clear your current order first.');break;}
      update(d=>d.bag[id]=(d.bag[id]||0)+1);
      if(!openShop)cart();
      notify('Added to your bag');
      break;
    }
    case 'remove':update(d=>{if(--d.bag[id]<=0)delete d.bag[id];});cart();break;
    case 'checkout':{
      const data=store(),items=bagItems(data);
      if(!items.length)break;
      if(data.paused.includes(items[0].shop)){notify('This outlet has paused ordering.');break;}
      if(apiUrl){
        const submitted=await sync({action:'checkout',shop:items[0].shop,address:data.address,items:items.map(item=>({index:Number(item.id.split(':')[1]),qty:item.qty}))});
        if(submitted){update(d=>d.bag={});tracking();notify('Order placed');}
        break;
      }
      update(d=>{d.orders.push({id:1001+d.orders.length,shop:items[0].shop,items,total:total(items)+39,address:d.address,stage:0});d.bag={};});
      tracking();notify('Order placed');
      break;
    }
    case 'toggle':if(apiUrl){await sync({action,id});break;}update(d=>d.paused=d.paused.includes(id)?d.paused.filter(s=>s!==id):[...d.paused,id]);break;
    case 'advance':if(apiUrl){await sync({action,id,stage:Number(stage)});break;}update(d=>{
      const o=d.orders.find(o=>String(o.id)===id);
      if(o&&o.stage===Number(stage)&&((role()==='outlet'&&o.shop===d.outlet&&o.stage<2)||(role()==='courier'&&o.stage>=2&&o.stage<4)))o.stage++;
    });break;
  }
});
document.addEventListener('input',event=>{if(event.target.id==='search'){query=event.target.value;fillResults(store());}});
document.addEventListener('change',event=>{
  if(event.target.id==='sort'){sort=event.target.value;fillResults(store());}
  if(event.target.id==='outlet-select')update(data=>data.outlet=event.target.value);
});
document.addEventListener('submit',event=>{
  if(event.target.id==='access-form'){
    event.preventDefault();
    credentials=new FormData(event.target).get('token').trim();
    sessionStorage.setItem(accessKey,credentials);
    render();
    sync();
    return;
  }
  if(event.target.id!=='address-form')return;
  event.preventDefault();
  const address=new FormData(event.target).get('address').trim();
  if(!address)return;
  update(data=>data.address=address);dialog.close();notify('Delivery address updated');
});
dialog.addEventListener('close',()=>openShop=null);
window.addEventListener('storage',event=>{if(event.key===key){render();if(dialog.open)dialog.close();}});
render();

if(apiUrl){sync();setInterval(()=>sync(),3000);}
