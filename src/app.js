import { simulate, timingOptimizer, decisionMatrix } from './engines/simulationEngine.js';
import { annualLoanSchedule } from './engines/loanEngine.js';
import { portfolioStats, rebalanceTopLevel } from './engines/portfolioEngine.js';
import { estimateTax } from './engines/withdrawalEngine.js';
import { lineChart, barLineChart } from './components/chart.js';
import { twMoney, twWan, pct, numberInput, parseNumberInput, clamp, star } from './utils/format.js';
import { saveState, loadState, clearState } from './utils/storage.js';

const $ = id => document.getElementById(id);
const modes = [
  ['balancedMarkov','Balanced Markov Regime'],
  ['historical','Historical Backtest'],
  ['worst','Worst Historical'],
  ['regime','Conservative Regime Monte Carlo'],
  ['extreme','Extreme Stress Test']
];
const strategies = [['classic','Classic COLA'],['dynamic','Dynamic COLA'],['smile','Spending Smile'],['guardrails','Guardrails']];
const freezeRules = [
  ['any','寬鬆：任一條件觸發'],
  ['balanced','平衡：高通膨+股/債下跌，或提領率過高'],
  ['withdrawalOnly','嚴格：只有提領率過高']
];
let state, loans, scenarios, portfolio;
const SIM_RUNS = 360;
const SIM_SEED = 202600;
const APP_VERSION = '6.2.0';
let contributionSort = { key: 'riskShare', dir: 'desc' };
let currentSim = null;
let currentMatrix = null;
let currentLoanRows = null;

const REAL_HOLDINGS = [
  { ticker:'ALAB2X', name:'Tradr 2X Long ALAB Daily ETF', market:'US', shares:32053, price:151.74, value:155220831, type:'槓桿單一股票 ETF', risk:'extreme', note:'Astera Labs 2x，每日槓桿，為目前最大集中風險與報酬來源。' },
  { ticker:'00631L', name:'元大台灣50正2', market:'TW', shares:350000, price:38.80, value:13580000, type:'台股槓桿 ETF', risk:'high', note:'台灣大型權值股 2x 日報酬，與台股/台積電高度相關。' },
  { ticker:'2330', name:'台積電', market:'TW', shares:3180, price:2445, value:7775100, type:'個股', risk:'high', note:'半導體核心持股，與 SOXX/00631L 有相關性。' },
  { ticker:'MRVL2X', name:'二倍做多 MRVL ETF - GraniteShares', market:'US', shares:2205, price:37.93, value:2669148, type:'槓桿單一股票 ETF', risk:'extreme', note:'Marvell 2x，每日槓桿，需納入前 10 年序列風險。' },
  { ticker:'MU2X', name:'二倍做多美光科技 ETF - Direxion', market:'US', shares:53, price:745.21, value:1260479, type:'槓桿單一股票 ETF', risk:'extreme', note:'Micron 2x，記憶體景氣循環曝險。' },
  { ticker:'NBIS2X', name:'GraniteShares 2x Long NBIS Daily ETF', market:'US', shares:535, price:33.16, value:566174, type:'槓桿單一股票 ETF', risk:'extreme', note:'NBIS 2x，小型高波動衛星部位。' },
  { ticker:'2330', name:'台積電（小帳）', market:'TW', shares:175, price:2445, value:427875, type:'個股', risk:'high', note:'台積電補充部位。' },
  { ticker:'2891', name:'中信金', market:'TW', shares:5000, price:70.60, value:353000, type:'金融股', risk:'medium', note:'台灣金融股，波動低於半導體與槓桿 ETF。' }
];
function realHoldingsTotal(){ return REAL_HOLDINGS.reduce((s,h)=>s+h.value,0); }
function highRiskHoldingValue(){ return REAL_HOLDINGS.filter(h=>['high','extreme'].includes(h.risk)).reduce((s,h)=>s+h.value,0); }

function netWorthFromInvestable(v){ return Number(v || 0) - Number(state?.netWorthGap || 0); }
function investableFromNetWorth(v){ return Number(v || 0) + Number(state?.netWorthGap || 0); }
async function loadJson(path){ return fetch(path).then(r=>r.json()); }
function control(id, label, min, max, step, value, onChange){
  const node=$(id); node.innerHTML='';
  const wrap=document.createElement('div'); wrap.className='control-row';
  wrap.innerHTML=`<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><input type="text" value="${numberInput(value)}">`;
  const range=wrap.querySelector('input[type=range]'), text=wrap.querySelector('input[type=text]');
  range.addEventListener('input',()=>{ text.value=numberInput(range.value); onChange(Number(range.value)); render(); });
  text.addEventListener('change',()=>{ const v=clamp(parseNumberInput(text.value),min,max); text.value=numberInput(v); range.value=v; onChange(v); render(); });
  node.append(wrap);
}

function numberOnlyControl(id, label, min, max, value, onChange){
  const node=$(id); node.innerHTML='';
  const wrap=document.createElement('div'); wrap.className='control-row number-only';
  wrap.innerHTML=`<label>${label}</label><input type="text" value="${numberInput(value)}">`;
  const text=wrap.querySelector('input[type=text]');
  text.addEventListener('change',()=>{ const v=clamp(parseNumberInput(text.value),min,max); text.value=numberInput(v); onChange(v); render(); });
  node.append(wrap);
}
function setControlValue(id, value){
  const node=$(id); if(!node) return;
  const range=node.querySelector('input[type=range]');
  const text=node.querySelector('input[type=text]');
  const rounded = Number(Number(value).toFixed(1));
  if(range) range.value = String(rounded);
  if(text) text.value = numberInput(rounded);
}
function syncTopLevelControls(){
  setControlValue('input-stock', portfolio.topLevel.stock);
  setControlValue('input-bond', portfolio.topLevel.bond);
  setControlValue('input-cash', portfolio.topLevel.cash);
}
function setStockShare(newStock){
  const cash = clamp(Number(portfolio.topLevel.cash || 0), 0, 95);
  const budget = Math.max(0, 100 - cash);
  const stock = clamp(Number(newStock || 0), 0, budget);
  const bond = Math.max(0, budget - stock);
  rebalanceTopLevel(portfolio, Number(stock.toFixed(1)), Number(bond.toFixed(1)), Number(cash.toFixed(1)));
  syncTopLevelControls();
}
function setBondShare(newBond){
  const cash = clamp(Number(portfolio.topLevel.cash || 0), 0, 95);
  const budget = Math.max(0, 100 - cash);
  const bond = clamp(Number(newBond || 0), 0, budget);
  const stock = Math.max(0, budget - bond);
  rebalanceTopLevel(portfolio, Number(stock.toFixed(1)), Number(bond.toFixed(1)), Number(cash.toFixed(1)));
  syncTopLevelControls();
}
function setCashShare(newCash){
  const oldStock = Number(portfolio.topLevel.stock || 0);
  const oldBond = Number(portfolio.topLevel.bond || 0);
  const cash = clamp(Number(newCash || 0), 0, 30);
  const budget = Math.max(0, 100 - cash);
  const nonCash = Math.max(0.0001, oldStock + oldBond);
  const stock = budget * oldStock / nonCash;
  const bond = budget - stock;
  rebalanceTopLevel(portfolio, Number(stock.toFixed(1)), Number(bond.toFixed(1)), Number(cash.toFixed(1)));
  syncTopLevelControls();
}
function syncGroupControls(parent, group){
  if (!parent || !group) return;
  parent.querySelectorAll('.asset-control').forEach(wrap => {
    const key = wrap.dataset.assetKey;
    if (!key || !group[key]) return;
    const value = Number(group[key].weight || 0);
    const r = wrap.querySelector('input[type=range]');
    const t = wrap.querySelector('input[type=text]');
    if (r) r.value = String(value);
    if (t) t.value = String(Number(value.toFixed(1)));
  });
}
function rebalanceGroupProportional(group, changedKey){
  const keys = Object.keys(group);
  const others = keys.filter(k => k !== changedKey);
  const changed = clamp(Number(group[changedKey]?.weight || 0), 0, 100);
  group[changedKey].weight = Number(changed.toFixed(1));
  const remaining = Math.max(0, 100 - changed);
  const otherTotal = others.reduce((sum, k) => sum + Number(group[k].weight || 0), 0);
  if (!others.length) return;
  let assigned = 0;
  if (otherTotal <= 0.0001) {
    const equal = remaining / others.length;
    others.forEach((k, i) => {
      const value = i === others.length - 1 ? remaining - assigned : Number(equal.toFixed(1));
      group[k].weight = Number(Math.max(0, value).toFixed(1));
      assigned += group[k].weight;
    });
  } else {
    others.forEach((k, i) => {
      const raw = remaining * Number(group[k].weight || 0) / otherTotal;
      const value = i === others.length - 1 ? remaining - assigned : Number(raw.toFixed(1));
      group[k].weight = Number(Math.max(0, value).toFixed(1));
      assigned += group[k].weight;
    });
  }
  const total = keys.reduce((sum, k) => sum + Number(group[k].weight || 0), 0);
  const drift = Number((100 - total).toFixed(1));
  if (Math.abs(drift) >= 0.1 && others.length) {
    const target = others[others.length - 1];
    group[target].weight = Number(Math.max(0, Number(group[target].weight || 0) + drift).toFixed(1));
  }
}

function pctControl(parent, key, label, obj, max=100, onChange=()=>{}){
  const wrap=document.createElement('div'); wrap.className='control-row asset-control';
  wrap.dataset.assetKey = key;
  const name = obj[key].name || '';
  const desc = obj[key].description || '';
  wrap.innerHTML=`<label><b>${key}</b>${name?`<span class="asset-name">${name}</span>`:''}${desc?`<small>${desc}</small>`:''}</label><input type="range" min="0" max="${max}" step="1" value="${obj[key].weight}"><input type="text" value="${obj[key].weight}">`;
  const r=wrap.querySelector('input[type=range]'), t=wrap.querySelector('input[type=text]');
  function apply(v){
    obj[key].weight = clamp(Number(v || 0), 0, max);
    onChange(key);
    syncGroupControls(parent, obj);
    render();
  }
  r.addEventListener('input',()=>apply(Number(r.value)));
  t.addEventListener('change',()=>apply(Number(t.value)));
  parent.append(wrap);
}
function setupControls(){
  control('input-investable','2026 可投資資產',120000000,350000000,1000000,state.investableAssets,v=>state.investableAssets=v);
  control('input-living','年度生活費',3000000,15000000,100000,state.annualLivingExpense,v=>state.annualLivingExpense=v);
  control('input-years','退休年限',20,60,1,state.retirementYears,v=>state.retirementYears=v);
  control('input-cape','Shiller CAPE',15,50,1,state.cape,v=>state.cape=v);
  control('input-income-self','我的年收入',0,30000000,100000,state.incomeSelf,v=>state.incomeSelf=v);
  control('input-income-spouse','家人年收入',0,30000000,100000,state.incomeSpouse,v=>state.incomeSpouse=v);
  control('input-stock','股票比例（調整後債券自動連動）',0,100,1,portfolio.topLevel.stock,v=>setStockShare(v));
  control('input-bond','債券比例（調整後股票自動連動）',0,100,1,portfolio.topLevel.bond,v=>setBondShare(v));
  numberOnlyControl('input-cash','現金比例（直接輸入，股票/債券按原比例重分配）',0,30,portfolio.topLevel.cash,v=>setCashShare(v));
  const ms=$('mode-select'); ms.innerHTML=modes.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); ms.value=state.marketMode; ms.onchange=()=>{state.marketMode=ms.value;render();};
  const ss=$('spending-select'); ss.innerHTML=strategies.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); ss.value=state.spendingStrategy; ss.onchange=()=>{state.spendingStrategy=ss.value;render();};
  $('dynamic-cola').checked=state.dynamicCola; $('dynamic-cola').onchange=e=>{state.dynamicCola=e.target.checked;render();};
  const fr=$('freeze-rule-select'); if(fr){ fr.innerHTML=freezeRules.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''); fr.value=state.dynamicColaFreezeRule || 'balanced'; fr.onchange=()=>{ state.dynamicColaFreezeRule=fr.value; render(); }; }
  if ($('input-freeze-inflation')) control('input-freeze-inflation','Freeze 通膨門檻 (%)',0,12,0.5,state.dynamicColaInflationThreshold ?? 5,v=>state.dynamicColaInflationThreshold=v);
  if ($('input-freeze-stock')) control('input-freeze-stock','Freeze 股票跌幅門檻 (%)',-50,0,1,state.dynamicColaStockDrawdownThreshold ?? state.dynamicColaDrawdownThreshold ?? -5,v=>state.dynamicColaStockDrawdownThreshold=v);
  if ($('input-freeze-bond')) control('input-freeze-bond','Freeze 債券跌幅門檻 (%)',-30,0,1,state.dynamicColaBondDrawdownThreshold ?? state.dynamicColaDrawdownThreshold ?? -5,v=>state.dynamicColaBondDrawdownThreshold=v);
  if ($('input-freeze-withdrawal')) control('input-freeze-withdrawal','Freeze 提領率門檻 (%)',2,10,0.1,state.dynamicColaWithdrawalThreshold ?? 4.5,v=>state.dynamicColaWithdrawalThreshold=v);
  const sb=$('scenario-buttons'); sb.innerHTML=''; scenarios.forEach(netWorth=>{
    const investable = investableFromNetWorth(netWorth);
    const b=document.createElement('button');
    b.innerHTML=`<b>${twMoney(netWorth,1)}</b>`;
    b.dataset.netWorth=String(netWorth);
    b.onclick=()=>{ state.investableAssets=investable; setupControls(); render(); };
    sb.append(b);
  });
  const eq=$('equity-controls'); eq.innerHTML=''; Object.keys(portfolio.equity).forEach(k=>pctControl(eq,k,k,portfolio.equity,80, changed=>rebalanceGroupProportional(portfolio.equity, changed)));
  const bd=$('bond-controls'); bd.innerHTML=''; Object.keys(portfolio.bond).forEach(k=>pctControl(bd,k,k,portfolio.bond,80, changed=>rebalanceGroupProportional(portfolio.bond, changed)));
}
function renderKpis(sim, loanRows){
  const income=state.incomeSelf+state.incomeSpouse; const tax=estimateTax(income,state.effectiveTaxByIncome); const after=income-tax; const first=sim.sample[0];
  const savings=Math.max(0,after-first.totalSpending); const saveRate=savings/Math.max(after,1)*100;
  const wr=first.totalSpending/state.investableAssets*100; const margin=sim.safemax-wr;
  const kpis=[['退休成功率',pct(sim.successRate,1),state.marketMode],['SAFE MAX',pct(sim.safemax,2),'CAPE '+state.cape],['第一年提領率',pct(wr,2),margin>=0?'低於 SAFE':'高於 SAFE'],['第一年總支出',twMoney(first.totalSpending),'生活費+貸款'],['稅後收入',twMoney(after),'所得稅估 '+twMoney(tax)],['年度新增投資',twMoney(savings),'儲蓄率 '+pct(saveRate,1)],['組合 CAGR',pct(sim.stats.cagr,1),'Vol '+pct(sim.stats.vol,1)],['貸款餘額',twWan(loanRows[0].loanBalance),'第一年底']];
  $('kpi-grid').innerHTML=kpis.map(([l,v,s])=>`<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
}
function table(node, headers, rows){ node.innerHTML=`<thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>`; }
function renderTables(sim, matrix, marginal){
  table($('cashflow-table'), ['年份','年齡','生活費','貸款','總支出','通膨','股票報酬','債券報酬','Freeze','提領率','投資報酬','新增投資','貸款餘額'], sim.sample.map(r=>`<tr><td>${r.year}</td><td>${r.age}</td><td>${twMoney(r.living)}</td><td>${twMoney(r.loanPayment)}</td><td>${twMoney(r.totalSpending)}</td><td>${pct(r.inflation,1)}</td><td>${pct(r.stockRet ?? 0,1)}</td><td>${pct(r.bondRet ?? 0,1)}</td><td>${r.freeze ? 'Y' : ''}</td><td>${pct(r.withdrawalRate,2)}</td><td>${twMoney(r.investmentReturn)}</td><td>${twMoney(r.contribution)}</td><td>${twWan(r.loanBalance)}</td></tr>`));
  table($('decision-table'), ['淨資產','可投資資產','第一年提領率','成功率','SAFE MAX','建議','邊際成功率'], matrix.map((r,i)=>`<tr><td>${twMoney(netWorthFromInvestable(r.assets),1)}</td><td>${twMoney(r.assets,1)}</td><td>${pct(r.firstWithdrawalRate,2)}</td><td>${pct(r.successRate,1)}</td><td>${pct(r.safemax,2)}</td><td>${r.advice}</td><td>${i===0?'—':pct(matrix[i].successRate-matrix[i-1].successRate,1)}</td></tr>`));
}
function buildContributionRows(stats) {
  const byTicker = new Map(stats.assets.map(a => [a.ticker, {
    ticker: a.ticker, name: a.name || '', description: a.description || '', weight: a.weight * 100,
    cagrContribution: 0, riskShare: 0, sharpeContribution: 0
  }]));
  stats.cagrContrib.forEach(r => { if (byTicker.has(r.ticker)) byTicker.get(r.ticker).cagrContribution = r.contribution; });
  stats.riskContrib.forEach(r => { if (byTicker.has(r.ticker)) byTicker.get(r.ticker).riskShare = r.riskShare; });
  stats.sharpeContrib.forEach(r => { if (byTicker.has(r.ticker)) byTicker.get(r.ticker).sharpeContribution = r.contribution; });
  const rows = [...byTicker.values()];
  const dir = contributionSort.dir === 'asc' ? 1 : -1;
  rows.sort((a,b) => (Number(a[contributionSort.key] || 0) - Number(b[contributionSort.key] || 0)) * dir);
  return rows;
}
function sortButton(key, label) {
  const arrow = contributionSort.key === key ? (contributionSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<button class="sort-btn" data-sort="${key}">${label}${arrow}</button>`;
}
function renderPortfolio(stats){
  const assetRows = stats.assets.map(a => `
    <div class="asset-row">
      <div><b>${a.ticker}</b><span>${a.name || ''}</span><small>${a.description || ''}</small></div>
      <strong>${pct(a.weight*100,1)}</strong>
    </div>`).join('');
  const rows = buildContributionRows(stats);
  $('portfolio-summary').innerHTML=`
    <div class="portfolio-stat"><div><span>CAGR</span><b>${pct(stats.cagr,1)}</b></div><div><span>Volatility</span><b>${pct(stats.vol,1)}</b></div><div><span>Sharpe</span><b>${stats.sharpe.toFixed(2)}</b></div></div>
    <h4>標的與目標市場</h4><div class="asset-list">${assetRows}</div>
    <h4>組合貢獻表 <small>點選欄位可排序</small></h4>
    <div class="contrib-table-wrap"><table class="contrib-table">
      <thead><tr>
        <th>${sortButton('ticker','標的')}</th>
        <th>${sortButton('weight','權重')}</th>
        <th>${sortButton('cagrContribution','CAGR 貢獻')}</th>
        <th>${sortButton('riskShare','風險貢獻')}</th>
        <th>${sortButton('sharpeContribution','Sharpe 貢獻')}</th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr title="${r.description || ''}">
        <td><b>${r.ticker}</b><span>${r.name}</span></td>
        <td>${pct(r.weight,1)}</td>
        <td>${pct(r.cagrContribution,2)}</td>
        <td>${pct(r.riskShare,1)}</td>
        <td>${r.sharpeContribution.toFixed(3)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="contrib-hint">CAGR 貢獻＝權重 × 該標的預估年化報酬。風險貢獻＝以權重與波動率估算，越高代表越影響組合震盪。Sharpe 貢獻＝對風險調整後報酬的近似貢獻。</p>`;
  document.querySelectorAll('#portfolio-summary .sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (contributionSort.key === key) contributionSort.dir = contributionSort.dir === 'asc' ? 'desc' : 'asc';
      else contributionSort = { key, dir: key === 'ticker' ? 'asc' : 'desc' };
      renderPortfolio(stats);
    });
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}
function downloadCsv(filename, headers, rows) {
  const csv = [headers.map(csvEscape).join(','), ...rows.map(row => row.map(csvEscape).join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function exportCashflowCsv() {
  if (!currentSim) return;
  const headers = ['年份','年齡','年初資產','年底資產','生活費','貸款','總支出','提領率','投資報酬','新增投資','貸款餘額','通膨','組合報酬','股票報酬','債券報酬','Freeze'];
  const rows = currentSim.sample.map(r => [r.year,r.age,Math.round(r.beginAssets),Math.round(r.assets),Math.round(r.living),Math.round(r.loanPayment),Math.round(r.totalSpending),r.withdrawalRate.toFixed(2),Math.round(r.investmentReturn),Math.round(r.contribution),Math.round(r.loanBalance),r.inflation?.toFixed?.(2) ?? '',r.ret?.toFixed?.(2) ?? '',r.stockRet?.toFixed?.(2) ?? '',r.bondRet?.toFixed?.(2) ?? '',r.freeze ? 'Y':'N']);
  downloadCsv('retirement_cashflow_v6_2.csv', headers, rows);
}
function exportDecisionCsv() {
  if (!currentMatrix) return;
  const headers = ['淨資產','可投資資產','第一年提領率','成功率','SAFE MAX','建議','邊際成功率'];
  const rows = currentMatrix.map((r,i) => [Math.round(netWorthFromInvestable(r.assets)),Math.round(r.assets),r.firstWithdrawalRate.toFixed(2),r.successRate.toFixed(1),r.safemax.toFixed(2),String(r.advice).replace(/^[^\s]+\s*/,''),i===0?'':(currentMatrix[i].successRate-currentMatrix[i-1].successRate).toFixed(1)]);
  downloadCsv('retirement_decision_matrix_v6_2.csv', headers, rows);
}
function renderDiagnostics(sim, matrix) {
  const first = sim.sample[0];
  const wr = first.totalSpending / Math.max(state.investableAssets,1) * 100;
  const gap = wr - sim.safemax;
  const maxLoan = Math.max(...sim.sample.map(r => r.loanPayment));
  const loanPressure = maxLoan / Math.max(first.totalSpending,1) * 100;
  const highRiskAssets = sim.stats.assets.filter(a => ['00631L','SOXX'].includes(a.ticker)).reduce((s,a)=>s+a.weight,0)*100;
  const decisionRow = matrix.find(r => Math.abs(r.assets - state.investableAssets) < 10000000) || matrix[0];
  const items = [
    {label:'提領壓力', value: gap > 1 ? '偏高' : gap > 0 ? '接近上限' : '安全', detail:`第一年提領率 ${pct(wr,2)}，SAFE ${pct(sim.safemax,2)}，差距 ${pct(gap,2)}。`},
    {label:'貸款壓力', value: loanPressure > 45 ? '偏高' : loanPressure > 30 ? '中等' : '可控', detail:`第一年貸款約佔總支出 ${pct(loanPressure,1)}，貸款自然遞減後提領壓力會下降。`},
    {label:'高波動資產', value: highRiskAssets > 25 ? '偏高' : highRiskAssets > 15 ? '中等' : '較低', detail:`00631L + SOXX 約佔整體投資 ${pct(highRiskAssets,1)}，是報酬與波動的主要來源。`},
    {label:'退休門檻', value: decisionRow?.advice || '—', detail:`目前條件下成功率約 ${pct(sim.successRate,1)}。若想提高成功率，可降低生活費、增加起始資產或降低高波動部位。`}
  ];
  const panel = $('diagnostics-panel');
  if (!panel) return;
  panel.innerHTML = items.map(it => `<div class="diag-item"><span>${it.label}</span><b>${it.value}</b><p>${it.detail}</p></div>`).join('');
}



function totalLoanBalance(list = loans) {
  return list.reduce((sum, l) => sum + Number(l.balance || 0), 0);
}
function cloneLoansWithPayoff(predicate) {
  let payoff = 0;
  const adjusted = loans.map(l => {
    if (predicate(l)) {
      payoff += Number(l.balance || 0);
      return { ...l, balance: 0, months: 0 };
    }
    return { ...l };
  });
  return { payoff, loans: adjusted };
}
function modeLabel() {
  return modes.find(m => m[0] === state.marketMode)?.[1] || state.marketMode;
}
function strategyLabel() {
  return strategies.find(s => s[0] === state.spendingStrategy)?.[1] || state.spendingStrategy;
}
function renderTrafficLight(sim) {
  const node = $('retirement-light');
  if (!node) return;
  const first = sim.sample[0];
  const wr = first.totalSpending / Math.max(state.investableAssets, 1) * 100;
  const loanPressure = first.loanPayment / Math.max(first.totalSpending, 1) * 100;
  let level = 'red', title = '🔴 建議保守 / 延後', detail = '目前成功率或第一年提領率仍偏緊，建議降低生活費、降低貸款壓力或提高可投資資產。';
  if (sim.successRate >= 95 && wr <= sim.safemax + 0.3 && loanPressure < 45) {
    level = 'green'; title = '🟢 可以退休'; detail = '成功率、提領率與貸款壓力都在較舒適區間。仍建議保留現金緩衝並定期檢查市場估值。';
  } else if (sim.successRate >= 88 && wr <= sim.safemax + 1.5) {
    level = 'yellow'; title = '🟡 可退休但需控支出'; detail = '初期仍受貸款或市場估值影響，建議用 Dynamic COLA 與彈性支出控管前 10 年序列風險。';
  }
  node.innerHTML = `<div class="traffic-card ${level}">
    <div><span>退休燈號</span><b>${title}</b><p>${detail}</p></div>
    <ul>
      <li>成功率：<strong>${pct(sim.successRate,1)}</strong></li>
      <li>第一年提領率：<strong>${pct(wr,2)}</strong></li>
      <li>SAFE MAX：<strong>${pct(sim.safemax,2)}</strong></li>
      <li>貸款占第一年支出：<strong>${pct(loanPressure,1)}</strong></li>
    </ul>
  </div>`;
}
function renderOneMoreYear(sim, timing) {
  const node = $('one-more-year');
  if (!node) return;
  const first = sim.sample[0];
  const income = state.incomeSelf + state.incomeSpouse;
  const tax = estimateTax(income, state.effectiveTaxByIncome);
  const after = income - tax;
  const annualSurplus = after - first.totalSpending;
  const loanDrop = totalLoanBalance() - (annualLoanSchedule(loans, 1, state.startYear)[0]?.loanBalance || 0);
  const projectedReturn = state.investableAssets * sim.stats.cagr / 100;
  const projectedInvestable = state.investableAssets + annualSurplus + projectedReturn;
  const now = timing[0] || { successRate: sim.successRate, firstWithdrawalRate: first.withdrawalRate };
  const next = timing[1] || now;
  const successGain = next.successRate - now.successRate;
  const wrDrop = now.firstWithdrawalRate - next.firstWithdrawalRate;
  node.innerHTML = `<div class="feature-summary"><p>以目前收入、稅後收入、生活費與貸款估算，再工作一年同時增加投資資產並降低貸款餘額。</p></div>
  <div class="mini-grid">
    <div><span>稅後收入</span><b>${twMoney(after)}</b></div>
    <div><span>年度新增投資</span><b>${twMoney(annualSurplus)}</b></div>
    <div><span>貸款本金下降</span><b>${twMoney(loanDrop)}</b></div>
    <div><span>預估一年後投資資產</span><b>${twMoney(projectedInvestable)}</b></div>
    <div><span>成功率變化</span><b>${successGain >= 0 ? '+' : ''}${pct(successGain,1)}</b></div>
    <div><span>第一年提領率下降</span><b>${wrDrop >= 0 ? '-' : '+'}${pct(Math.abs(wrDrop),2)}</b></div>
  </div>`;
}
function renderLoanStrategies(sim) {
  const node = $('loan-strategy');
  if (!node) return;
  const baselineLoans = loans.map(l => ({ ...l }));
  const short = cloneLoansWithPayoff(l => Number(l.months) <= 84 && !String(l.name).includes('HSBC'));
  const highApr = cloneLoansWithPayoff(l => Number(l.apr || 0) >= 2.6 && !String(l.name).includes('HSBC'));
  const all = cloneLoansWithPayoff(l => true);
  const rows = [
    { name: '維持貸款，資金繼續投資', payoff: 0, loans: baselineLoans, note: '可投資資產最高，但退休初期現金流壓力最大。' },
    { name: '清償短期信貸 / 個貸', payoff: short.payoff, loans: short.loans, note: '降低前 7 年貸款壓力，適合退休前降槓桿。' },
    { name: '優先清高利率貸款', payoff: highApr.payoff, loans: highApr.loans, note: '兼顧降低利息與保留部分投資資產。' },
    { name: '全數清償貸款', payoff: all.payoff, loans: all.loans, note: '現金流最輕，但會大幅降低可投資資產。' }
  ].map((r, i) => {
    const cfg = { ...state, investableAssets: Math.max(0, state.investableAssets - r.payoff) };
    const s = i === 0 ? sim : simulate(cfg, r.loans, portfolio, Math.max(160, Math.floor(SIM_RUNS / 2)), SIM_SEED + 7000 + i * 101);
    const loanFirst = annualLoanSchedule(r.loans, 1, state.startYear)[0]?.loanPayment || 0;
    const first = s.sample[0];
    return { ...r, successRate: s.successRate, investable: cfg.investableAssets, firstLoan: loanFirst, firstWR: first.withdrawalRate };
  });
  node.innerHTML = `<div class="feature-summary"><p>比較不同降槓桿策略對第一年現金流、可投資資產與退休成功率的影響。</p></div>
  <div class="table-wrap no-scroll"><table class="feature-table"><thead><tr><th>策略</th><th>需動用資金</th><th>剩餘可投資資產</th><th>第一年貸款</th><th>第一年提領率</th><th>成功率</th><th>解讀</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td><b>${r.name}</b></td><td>${twMoney(r.payoff)}</td><td>${twMoney(r.investable)}</td><td>${twMoney(r.firstLoan)}</td><td>${pct(r.firstWR,2)}</td><td>${pct(r.successRate,1)}</td><td>${r.note}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderSpendingTiers() {
  const node = $('spending-tiers');
  if (!node) return;
  const living = Number(state.annualLivingExpense || 0);
  const tiers = [
    { name: '基本生活', ratio: 0.45, cut: '不可砍', note: '食衣住行、基本家庭支出。' },
    { name: '保險 / 車 / 房屋維護', ratio: 0.20, cut: '低', note: '固定性高，需提前預留。' },
    { name: '旅遊娛樂', ratio: 0.20, cut: '高', note: '熊市時最適合暫緩。' },
    { name: '彈性消費', ratio: 0.15, cut: '高', note: 'Dynamic COLA 與 Guardrails 的主要調整來源。' }
  ];
  const cuttable = tiers.filter(t => t.cut === '高').reduce((s,t)=>s+living*t.ratio,0);
  node.innerHTML = `<div class="feature-summary"><p>把年度生活費拆成不可砍與可調整項目，讓熊市時的支出控制更接近真實生活。</p></div>
  <div class="mini-grid"><div><span>年度生活費</span><b>${twMoney(living)}</b></div><div><span>高彈性支出</span><b>${twMoney(cuttable)}</b></div><div><span>熊市建議降幅</span><b>${twMoney(cuttable*0.35)}</b></div><div><span>最低核心生活</span><b>${twMoney(living-cuttable*0.35)}</b></div></div>
  <div class="table-wrap no-scroll"><table class="feature-table"><thead><tr><th>層級</th><th>金額</th><th>可調整性</th><th>說明</th></tr></thead><tbody>${tiers.map(t=>`<tr><td><b>${t.name}</b></td><td>${twMoney(living*t.ratio)}</td><td>${t.cut}</td><td>${t.note}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderAnnualReport(sim) {
  const node = $('annual-report');
  if (!node) return;
  const r = sim.sample[0];
  const loanDrop = totalLoanBalance() - r.loanBalance;
  let nextBudget = r.living;
  let recommendation = '維持目前年度生活費，持續觀察市場與貸款餘額。';
  if (sim.successRate >= 96 && r.withdrawalRate < sim.safemax - 0.4) { nextBudget = r.living * 1.03; recommendation = '安全餘裕較高，可小幅增加彈性預算或提高現金緩衝。'; }
  else if (sim.successRate < 90 || r.withdrawalRate > sim.safemax + 0.8) { nextBudget = r.living * 0.95; recommendation = '建議暫時降低彈性支出，優先把提領率壓回安全區。'; }
  node.innerHTML = `<div class="feature-summary"><p>以目前設定產生 2026 年退休現金流快照，作為年度檢討與下一年度預算依據。</p></div>
  <div class="report-grid">
    <div><span>年初可投資資產</span><b>${twMoney(r.beginAssets)}</b></div>
    <div><span>年底可投資資產</span><b>${twMoney(r.assets)}</b></div>
    <div><span>實際生活費</span><b>${twMoney(r.living)}</b></div>
    <div><span>貸款支出</span><b>${twMoney(r.loanPayment)}</b></div>
    <div><span>實際提領率</span><b>${pct(r.withdrawalRate,2)}</b></div>
    <div><span>貸款餘額下降</span><b>${twMoney(loanDrop)}</b></div>
    <div><span>投資報酬</span><b>${twMoney(r.investmentReturn)}</b></div>
    <div><span>下一年建議生活費</span><b>${twMoney(nextBudget)}</b></div>
  </div>
  <div class="annual-comment"><b>年度建議：</b>${recommendation}</div>`;
}

function renderRealHoldings() {
  const node = $('real-holdings');
  if (!node) return;
  const total = realHoldingsTotal();
  const visibleCoverage = total / Math.max(1, state.investableAssets) * 100;
  const top = [...REAL_HOLDINGS].sort((a,b)=>b.value-a.value);
  const rows = top.map(h => {
    const share = h.value / Math.max(1, total) * 100;
    const cls = h.risk === 'extreme' ? 'status-bad' : h.risk === 'high' ? 'status-warn' : 'status-good';
    return `<tr><td><b>${h.ticker}</b><span>${h.name}</span></td><td>${h.market}</td><td>${h.type}</td><td>${twMoney(h.value)}</td><td>${pct(share,1)}</td><td class="${cls}">${h.risk}</td><td>${h.note}</td></tr>`;
  }).join('');
  node.innerHTML = `<div class="mini-grid">
    <div><span>截圖持股合計</span><b>${twMoney(total)}</b></div>
    <div><span>占目前可投資資產</span><b>${pct(visibleCoverage,1)}</b></div>
    <div><span>高波動持股占截圖</span><b>${pct(highRiskHoldingValue()/Math.max(1,total)*100,1)}</b></div>
    <div><span>最大單一部位</span><b>${top[0]?.ticker || '—'}</b></div>
  </div>
  <div class="table-wrap no-scroll"><table class="feature-table holdings-table"><thead><tr><th>標的</th><th>市場</th><th>類型</th><th>市值</th><th>占截圖</th><th>風險</th><th>說明</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="contrib-hint">目前依截圖可辨識持股建立清單；後續若提供完整 CSV，可進一步取代模型中的 ETF 假設。</p>`;
}

function renderGlidePath(sim) {
  const node = $('glide-path');
  if (!node) return;
  const highRiskShare = highRiskHoldingValue() / Math.max(1, realHoldingsTotal()) * 100;
  const plan = [
    { year: 2026, age: 41, target: Math.min(45, Math.round(highRiskShare)), action:'不一次賣出，先建立 2 年現金/短債緩衝。' },
    { year: 2028, age: 43, target: 35, action:'將部分單一股票 2x ETF 轉入 VOO / SGOV。' },
    { year: 2030, age: 45, target: 25, action:'把 ALAB2X、MRVL2X 合計降至衛星部位。' },
    { year: 2033, age: 48, target: 18, action:'高波動部位以 00631L / SOXX 為主，降低單一股票槓桿。' },
    { year: 2036, age: 51, target: 12, action:'退休中期維持核心 ETF + 債券，再視燈號調整。' }
  ];
  node.innerHTML = `<div class="feature-summary"><p>Glide Path 的目標不是預測股價，而是降低退休前 10 年遭遇股災時的序列風險。</p></div>
  <div class="mini-grid">
    <div><span>目前高波動占截圖</span><b>${pct(highRiskShare,1)}</b></div>
    <div><span>5 年後建議上限</span><b>25%</b></div>
    <div><span>10 年後建議上限</span><b>12%</b></div>
    <div><span>主要轉入資產</span><b>VOO / SGOV</b></div>
  </div>
  <div class="table-wrap no-scroll"><table class="feature-table"><thead><tr><th>年份</th><th>年齡</th><th>高波動部位目標</th><th>建議動作</th></tr></thead><tbody>${plan.map(p=>`<tr><td>${p.year}</td><td>${p.age}</td><td>${pct(p.target,0)}</td><td>${p.action}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderSequenceRisk(sim) {
  const node = $('sequence-risk');
  if (!node) return;
  const firstSpending = sim.sample[0]?.totalSpending || state.annualLivingExpense;
  const scenarios = [
    { name:'前 3 年股災', stock:[-35,-15,8], bond:[5,3,2], note:'模擬退休初期立刻遇到大熊市。' },
    { name:'股債雙殺', stock:[-22,-8,10], bond:[-12,-6,4], note:'類似 2022，股票與長債同跌。' },
    { name:'槓桿 ETF 腰斬', stock:[-45,12,8], bond:[4,3,3], note:'00631L / 2x 單一股票 ETF 壓力測試。' },
    { name:'前 10 年年化 0%', stock:[0,0,0], bond:[2,2,2], note:'長時間低報酬，檢查現金流韌性。' }
  ].map(s => {
    let assets = state.investableAssets;
    for (let y=0; y<10; y++) {
      const sr = s.stock[Math.min(y,s.stock.length-1)];
      const br = s.bond[Math.min(y,s.bond.length-1)];
      const ret = (portfolio.topLevel.stock/100)*sr + (portfolio.topLevel.bond/100)*br + (portfolio.topLevel.cash/100)*2;
      const loan = annualLoanSchedule(loans, 10, state.startYear)[y]?.loanPayment || 0;
      assets = Math.max(0, assets * (1 + ret/100) - firstSpending * Math.pow(1.015,y) - loan);
    }
    return { ...s, endAssets: assets, survives: assets > 0 };
  });
  node.innerHTML = `<div class="feature-summary"><p>這不是完整 Monte Carlo，而是專門檢查退休前 10 年的壓力情境；若這裡都撐得住，退休計畫韌性較高。</p></div>
  <div class="table-wrap no-scroll"><table class="feature-table"><thead><tr><th>壓力情境</th><th>10 年後資產</th><th>結果</th><th>說明</th></tr></thead><tbody>${scenarios.map(s=>`<tr><td><b>${s.name}</b></td><td>${twMoney(s.endAssets)}</td><td>${s.survives?'🟢 撐得住':'🔴 資產耗盡'}</td><td>${s.note}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderSpendingRecommendation(sim) {
  const node = $('spending-recommendation');
  if (!node) return;
  const first = sim.sample[0];
  const current = Number(state.annualLivingExpense || 0);
  const wr = first.totalSpending / Math.max(1, state.investableAssets) * 100;
  let range, label, rationale;
  if (sim.successRate >= 96 && wr <= sim.safemax + 0.3) {
    range = [current * 0.95, current * 1.18]; label = '🟢 可舒適支出'; rationale = '成功率與提領率都有餘裕，可小幅提高旅遊娛樂或彈性預算。';
  } else if (sim.successRate >= 88 && wr <= sim.safemax + 1.5) {
    range = [current * 0.85, current * 1.02]; label = '🟡 建議控支出'; rationale = '可以退休但前期貸款與市場估值仍有壓力，建議把生活費控制在目前附近。';
  } else {
    range = [current * 0.65, current * 0.88]; label = '🔴 建議防守'; rationale = '成功率或提領率偏緊，應先降低旅遊娛樂與彈性消費，保留現金緩衝。';
  }
  node.innerHTML = `<div class="mini-grid">
    <div><span>目前年度生活費</span><b>${twMoney(current)}</b></div>
    <div><span>建議年度範圍</span><b>${twMoney(range[0])}～${twMoney(range[1])}</b></div>
    <div><span>退休燈號建議</span><b>${label}</b></div>
    <div><span>SAFE MAX 差距</span><b>${pct(wr - sim.safemax,2)}</b></div>
  </div><div class="annual-comment"><b>建議：</b>${rationale}</div>`;
}

function renderPersonalDecision(sim, timing) {
  renderTrafficLight(sim);
  renderOneMoreYear(sim, timing);
  renderLoanStrategies(sim);
  renderSpendingTiers();
  renderAnnualReport(sim);
  renderRealHoldings();
  renderGlidePath(sim);
  renderSequenceRisk(sim);
  renderSpendingRecommendation(sim);
}

function renderNotes(){
  const mode=modes.find(m=>m[0]===state.marketMode)?.[1]; const strat=strategies.find(s=>s[0]===state.spendingStrategy)?.[1];
  $('model-notes').innerHTML=`
  <div class="note-item"><b>🧭 市場模式：${mode}</b><br>第一選項為 Balanced Markov Regime：用市場狀態轉移模擬牛市、修正、熊市、危機、復甦與高通膨，避免每年獨立亂抽造成過多不合理連續崩盤。第二選項為 Historical Backtest，作為 Bengen 式歷史序列基準。</div>
  <div class="note-item"><b>💸 支出策略：${strat}</b><br>Spending Smile 預設：生活費不是每年完整跟 CPI 上調；退休前 10 年最多按 1.2% 小幅增加，中期可能持平或下降，晚年再預留醫療支出上升空間。若啟用 Freeze，符合條件時該年生活費不調升。</div>
  <div class="note-item"><b>🛡️ Dynamic COLA Freeze</b><br>可自訂門檻：通膨率、股票報酬跌幅、債券報酬跌幅與提領率門檻。寬鬆＝任一條件觸發；平衡＝高通膨且股/債其中一項跌破門檻，或提領率過高；嚴格＝只有提領率過高才暫停調升生活費。</div>
  <div class="note-item"><b>📈 股票配置</b><br>股票 65% 預設拆成：00631L 20%、VOO/VTI/VXUS 合計 60%、SOXX 20%。整體資產約為 00631L 13%、SOXX 13%、美國/全球核心 ETF 39%。</div>`;
}
function render(){
  [...document.querySelectorAll('#scenario-buttons button')].forEach(b=>{ const n=Number(b.dataset.netWorth||0); b.classList.toggle('active', Math.abs(n-netWorthFromInvestable(state.investableAssets))<10000000); });
  const sim=simulate(state,loans,portfolio,SIM_RUNS,SIM_SEED); const loanRows=annualLoanSchedule(loans,state.retirementYears,state.startYear); const timing=timingOptimizer(state,loans,portfolio,{runs:SIM_RUNS,seedBase:SIM_SEED}); const matrix=decisionMatrix(state,loans,portfolio,scenarios.map(investableFromNetWorth),{runs:SIM_RUNS,seedBase:SIM_SEED});
  currentSim = sim; currentMatrix = matrix; currentLoanRows = loanRows;
  renderKpis(sim, loanRows); renderTables(sim,matrix,[]); renderPortfolio(sim.stats); renderDiagnostics(sim, matrix); renderPersonalDecision(sim, timing); renderNotes();
  requestAnimationFrame(() => {
    lineChart($('asset-chart'),{data:sim.percentiles,series:[{key:'p10',label:'P10 悲觀',className:'red'},{key:'p50',label:'P50 中位數',className:'blue'},{key:'p60',label:'P60 樂觀',className:'green'}],height:260,yMin:0,yMax:1200000000,yStep:200000000});
    barLineChart($('expense-chart'),{data:sim.sample,bars:[{key:'living',label:'生活費',className:'green'},{key:'loanPayment',label:'貸款',className:'amber'}],lines:[{key:'totalSpending',label:'總支出',className:'blue'}],y2Series:{key:'inflation',label:'通膨率（右軸）',className:'red'},y2Format:v=>pct(v,1),y2Min:0,y2Max:10,y2Step:2,height:260,yMin:0,yMax:12000000,yStep:2000000});
    lineChart($('loan-chart'),{data:loanRows.map(r=>({...r,loanBalanceWan:r.loanBalance/10000})),series:[{key:'loanBalanceWan',label:'貸款餘額（萬）',className:'amber'}],yFormat:v=>`${Math.round(v).toLocaleString()}萬`,height:260,yMin:0,yMax:6000,yStep:1000});
    lineChart($('timing-chart'),{data:timing,series:[{key:'successRate',label:'成功率（左軸）',className:'green'}],yFormat:v=>pct(v,0),yMin:0,yMax:100,yStep:20,y2Series:{key:'firstWithdrawalRate',label:'第一年提領率（右軸）',className:'blue'},y2Format:v=>pct(v,1),y2Min:0,y2Max:10,y2Step:2,height:260});
  });
}
function showSaveModal(){
  const modal = $('save-modal');
  if (!modal) return;
  modal.hidden = false;
  modal.setAttribute('aria-hidden','false');
  const close = $('save-modal-close');
  if (close) close.focus();
}
function hideSaveModal(){
  const modal = $('save-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden','true');
}

async function hardRefreshApp(){
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } catch (err) {
    console.warn('Hard refresh cleanup failed', err);
  }
  const base = window.location.origin + window.location.pathname;
  window.location.href = `${base}?v=${Date.now()}`;
}
function resetToDefaults(){
  clearState();
  const base = window.location.origin + window.location.pathname;
  window.location.href = `${base}?reset=${Date.now()}`;
}

async function init(){
  const [assumptions, loanData, port, scen] = await Promise.all([loadJson('./data/assumptions.json'),loadJson('./data/loans.json'),loadJson('./data/portfolio.json'),loadJson('./data/scenarios.json')]);
  const saved = loadState();
  state = { ...assumptions, ...(saved?.state || {}) };
  // v5.1 changes default living expense from 600萬 to 500萬.
  // If an older saved profile still has the old untouched default 600萬, migrate it once.
  if (!saved?.version && state.annualLivingExpense === 6000000) state.annualLivingExpense = assumptions.annualLivingExpense;
  // v6.2 fallback for older saved profiles.
  state.dynamicColaInflationThreshold ??= assumptions.dynamicColaInflationThreshold ?? 5;
  state.dynamicColaStockDrawdownThreshold ??= assumptions.dynamicColaStockDrawdownThreshold ?? state.dynamicColaDrawdownThreshold ?? -5;
  state.dynamicColaBondDrawdownThreshold ??= assumptions.dynamicColaBondDrawdownThreshold ?? state.dynamicColaDrawdownThreshold ?? -5;
  state.dynamicColaWithdrawalThreshold ??= assumptions.dynamicColaWithdrawalThreshold ?? 4.5;
  loans=loanData; portfolio = saved?.portfolio || port; scenarios=scen;
  setupControls(); render();
  $('save-btn').onclick=()=>{ saveState({version: APP_VERSION, state, portfolio}); showSaveModal(); };
  $('update-app-btn')?.addEventListener('click', hardRefreshApp);
  $('reset-default-btn')?.addEventListener('click', resetToDefaults);
  $('export-cashflow-btn')?.addEventListener('click', exportCashflowCsv);
  $('export-decision-btn')?.addEventListener('click', exportDecisionCsv);
  $('save-modal-close')?.addEventListener('click', hideSaveModal);
  $('save-modal')?.addEventListener('click', e=>{ if(e.target.id==='save-modal') hideSaveModal(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideSaveModal(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=6.2.0').catch(()=>{});
}
init();
