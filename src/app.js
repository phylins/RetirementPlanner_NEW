import { simulate, timingOptimizer, decisionMatrix } from './engines/simulationEngine.js';
import { annualLoanSchedule } from './engines/loanEngine.js';
import { portfolioStats, rebalanceTopLevel } from './engines/portfolioEngine.js';
import { estimateTax } from './engines/withdrawalEngine.js';
import { lineChart, barLineChart } from './components/chart.js';
import { twMoney, twWan, pct, numberInput, parseNumberInput, clamp, star } from './utils/format.js';
import { saveState, loadState } from './utils/storage.js';

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
const APP_VERSION = '5.8.0';
let contributionSort = { key: 'riskShare', dir: 'desc' };
let currentSim = null;
let currentMatrix = null;
let currentLoanRows = null;
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
  downloadCsv('retirement_cashflow_v5_8.csv', headers, rows);
}
function exportDecisionCsv() {
  if (!currentMatrix) return;
  const headers = ['淨資產','可投資資產','第一年提領率','成功率','SAFE MAX','建議','邊際成功率'];
  const rows = currentMatrix.map((r,i) => [Math.round(netWorthFromInvestable(r.assets)),Math.round(r.assets),r.firstWithdrawalRate.toFixed(2),r.successRate.toFixed(1),r.safemax.toFixed(2),String(r.advice).replace(/^[^\s]+\s*/,''),i===0?'':(currentMatrix[i].successRate-currentMatrix[i-1].successRate).toFixed(1)]);
  downloadCsv('retirement_decision_matrix_v5_8.csv', headers, rows);
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
  renderKpis(sim, loanRows); renderTables(sim,matrix,[]); renderPortfolio(sim.stats); renderDiagnostics(sim, matrix); renderNotes();
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
async function init(){
  const [assumptions, loanData, port, scen] = await Promise.all([loadJson('./data/assumptions.json'),loadJson('./data/loans.json'),loadJson('./data/portfolio.json'),loadJson('./data/scenarios.json')]);
  const saved = loadState();
  state = { ...assumptions, ...(saved?.state || {}) };
  // v5.1 changes default living expense from 600萬 to 500萬.
  // If an older saved profile still has the old untouched default 600萬, migrate it once.
  if (!saved?.version && state.annualLivingExpense === 6000000) state.annualLivingExpense = assumptions.annualLivingExpense;
  // v5.8 fallback for older saved profiles.
  state.dynamicColaInflationThreshold ??= assumptions.dynamicColaInflationThreshold ?? 5;
  state.dynamicColaStockDrawdownThreshold ??= assumptions.dynamicColaStockDrawdownThreshold ?? state.dynamicColaDrawdownThreshold ?? -5;
  state.dynamicColaBondDrawdownThreshold ??= assumptions.dynamicColaBondDrawdownThreshold ?? state.dynamicColaDrawdownThreshold ?? -5;
  state.dynamicColaWithdrawalThreshold ??= assumptions.dynamicColaWithdrawalThreshold ?? 4.5;
  loans=loanData; portfolio = saved?.portfolio || port; scenarios=scen;
  setupControls(); render();
  $('save-btn').onclick=()=>{ saveState({version: APP_VERSION, state, portfolio}); showSaveModal(); };
  $('export-cashflow-btn')?.addEventListener('click', exportCashflowCsv);
  $('export-decision-btn')?.addEventListener('click', exportDecisionCsv);
  $('save-modal-close')?.addEventListener('click', hideSaveModal);
  $('save-modal')?.addEventListener('click', e=>{ if(e.target.id==='save-modal') hideSaveModal(); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideSaveModal(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=5.8.0').catch(()=>{});
}
init();
