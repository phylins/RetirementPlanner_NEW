import { annualLoanSchedule } from './loanEngine.js';
import { portfolioStats } from './portfolioEngine.js';
import { estimateTax, inflationFor, livingExpenseByStrategy, safemaxFromCAPE } from './withdrawalEngine.js';

function seededRandom(seed) {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => (x = x * 16807 % 2147483647) / 2147483647;
}
function normal(rand) {
  const u = Math.max(rand(), 1e-9), v = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function classProfile(stats, className, fallbackCagr, fallbackVol) {
  const list = stats.assets.filter(a => a.className === className);
  const w = list.reduce((s, a) => s + a.weight, 0);
  if (!list.length || w <= 0) return { cagr: fallbackCagr, vol: fallbackVol, weight: 0 };
  const cagr = list.reduce((s, a) => s + a.weight * a.cagr, 0) / w;
  const vol = list.reduce((s, a) => s + a.weight * a.vol, 0) / w;
  return { cagr, vol, weight: w };
}
function combineReturns(stats, stockRet, bondRet, cashRet = 2.0) {
  const stockWeight = stats.assets.filter(a => a.className === '股票').reduce((s, a) => s + a.weight, 0);
  const bondWeight = stats.assets.filter(a => a.className === '債券').reduce((s, a) => s + a.weight, 0);
  const cashWeight = stats.assets.filter(a => a.className === '現金').reduce((s, a) => s + a.weight, 0);
  return stockWeight * stockRet + bondWeight * bondRet + cashWeight * cashRet;
}

function pickTransition(rand, current, matrix) {
  const choices = matrix[current] || matrix.Normal;
  const r = rand();
  let acc = 0;
  for (const [state, prob] of choices) {
    acc += prob;
    if (r <= acc) return state;
  }
  return choices[choices.length - 1][0];
}
function balancedMarkovReturn(rand, stats, y, currentState = 'Normal') {
  const matrix = {
    Normal: [['Bull',0.38],['Normal',0.36],['Correction',0.10],['Bear',0.05],['Recovery',0.06],['HighInflation',0.05]],
    Bull: [['Bull',0.70],['Normal',0.18],['Correction',0.08],['Bear',0.02],['HighInflation',0.02]],
    Correction: [['Recovery',0.35],['Normal',0.30],['Bull',0.15],['Bear',0.15],['HighInflation',0.05]],
    Bear: [['Recovery',0.45],['Bear',0.20],['Normal',0.20],['Crisis',0.05],['HighInflation',0.10]],
    Crisis: [['Recovery',0.60],['Bear',0.20],['Normal',0.15],['HighInflation',0.05]],
    Recovery: [['Bull',0.50],['Normal',0.30],['Recovery',0.15],['HighInflation',0.05]],
    HighInflation: [['Normal',0.45],['Recovery',0.20],['HighInflation',0.15],['Bear',0.10],['Bull',0.10]]
  };
  const regime = y === 0 ? currentState : pickTransition(rand, currentState, matrix);
  const stock = classProfile(stats, '股票', 9.0, 22.0);
  const bond = classProfile(stats, '債券', 3.8, 8.0);
  let stockMean = stock.cagr, stockVol = stock.vol * 0.75;
  let bondMean = bond.cagr, bondVol = bond.vol * 0.75;
  let inf = 1.8 + rand() * 1.2;
  if (regime === 'Bull') {
    stockMean = stock.cagr + 3.0; stockVol = stock.vol * 0.70;
    bondMean = bond.cagr + 0.2; bondVol = bond.vol * 0.65;
    inf = 1.5 + rand() * 1.3;
  } else if (regime === 'Correction') {
    stockMean = -8.0; stockVol = Math.min(stock.vol * 0.85, 24);
    bondMean = bond.cagr + 0.8; bondVol = bond.vol * 0.75;
    inf = 1.0 + rand() * 2.0;
  } else if (regime === 'Bear') {
    stockMean = -14.0; stockVol = Math.min(stock.vol * 0.90, 26);
    bondMean = bond.cagr + 1.2; bondVol = bond.vol * 0.80;
    inf = 0.5 + rand() * 2.5;
  } else if (regime === 'Crisis') {
    stockMean = -28.0; stockVol = Math.min(stock.vol * 0.75, 24);
    bondMean = bond.cagr + 2.5; bondVol = bond.vol * 0.70;
    inf = 0.5 + rand() * 2.0;
  } else if (regime === 'Recovery') {
    stockMean = stock.cagr + 6.0; stockVol = stock.vol * 0.80;
    bondMean = bond.cagr; bondVol = bond.vol * 0.70;
    inf = 1.5 + rand() * 2.0;
  } else if (regime === 'HighInflation') {
    stockMean = -2.0; stockVol = Math.min(stock.vol * 0.75, 24);
    bondMean = -3.0; bondVol = Math.min(bond.vol * 0.80, 12);
    inf = 4.0 + rand() * 2.5;
  }
  const stockRet = stockMean + normal(rand) * stockVol;
  const bondRet = bondMean + normal(rand) * bondVol;
  const cashRet = Math.max(0, Math.min(5, inf * 0.55 + 1.2));
  return { ret: combineReturns(stats, stockRet, bondRet, cashRet), stockRet, bondRet, cashRet, inflation: inf, regime: `Balanced ${regime}`, nextRegime: regime };
}

function regimeReturn(rand, stats, y) {
  const stock = classProfile(stats, '股票', 9.0, 22.0);
  const bond = classProfile(stats, '債券', 3.8, 8.0);
  const r = rand();
  let stockMean = stock.cagr, stockVol = stock.vol;
  let bondMean = bond.cagr, bondVol = bond.vol;
  let inf = inflationFor('regime', y);
  let regime = 'Normal';
  if (r < 0.56) {
    regime = 'Bull';
    stockMean += 3.5; stockVol *= 0.85;
    bondMean += 0.3; bondVol *= 0.75;
    inf = 1.6 + rand() * 1.2;
  } else if (r < 0.73) {
    regime = 'Bear';
    stockMean = -15; stockVol *= 1.20;
    bondMean += 1.0; bondVol *= 0.95;
    inf = 0.5 + rand() * 2.0;
  } else if (r < 0.89) {
    regime = 'Recovery';
    stockMean += 7.0; stockVol *= 1.05;
    bondMean += 0.2; bondVol *= 0.85;
    inf = 1.5 + rand() * 2.5;
  } else {
    regime = 'High inflation';
    stockMean = -4.0; stockVol *= 1.10;
    bondMean = -6.0; bondVol *= 1.15;
    inf = 4.5 + rand() * 3.5;
  }
  const stockRet = stockMean + normal(rand) * stockVol;
  const bondRet = bondMean + normal(rand) * bondVol;
  const cashRet = Math.max(0, Math.min(5, inf * 0.55 + 1.2));
  return { ret: combineReturns(stats, stockRet, bondRet, cashRet), stockRet, bondRet, cashRet, inflation: inf, regime };
}
function shouldFreezeCola(config, inflation, stockRet, bondRet, withdrawalRateBefore) {
  if (!config.dynamicCola) return false;
  const highInflation = inflation > Number(config.dynamicColaInflationThreshold ?? 5.0);
  const badStock = stockRet < Number(config.dynamicColaStockDrawdownThreshold ?? config.dynamicColaDrawdownThreshold ?? -5.0);
  const badBond = bondRet < Number(config.dynamicColaBondDrawdownThreshold ?? config.dynamicColaDrawdownThreshold ?? -5.0);
  const highWithdrawal = withdrawalRateBefore > Number(config.dynamicColaWithdrawalThreshold ?? 4.5);
  const rule = config.dynamicColaFreezeRule || 'balanced';
  if (rule === 'any') return highInflation || badStock || badBond || highWithdrawal;
  if (rule === 'withdrawalOnly') return highWithdrawal;
  // balanced: freeze only when high inflation and either stocks or bonds are weak, or withdrawal rate is already too high.
  return (highInflation && (badStock || badBond)) || highWithdrawal;
}
function modeReturn(mode, stats, y, rand, markovState) {
  if (mode === 'balancedMarkov') return balancedMarkovReturn(rand, stats, y, markovState);
  if (mode === 'historical') {
    const stockSeq = [12,-8,22,5,-15,18,9,7,-4,14,3,11,-20,26,15,2];
    const bondSeq = [4,6,2,5,7,3,4,5,6,3,4,5,8,2,3,4];
    const stockRet = stockSeq[y % stockSeq.length];
    const bondRet = bondSeq[y % bondSeq.length];
    return { ret: combineReturns(stats, stockRet, bondRet, 2), stockRet, bondRet, cashRet: 2, inflation: inflationFor('historical', y), regime: 'Historical' };
  }
  if (mode === 'worst') {
    const stockSeq = [-37,-18,-8,15,10,-22,5,12,7,8,5,4];
    const bondSeq = [5,7,4,2,-8,6,3,4,5,3,4,4];
    const stockRet = stockSeq[Math.min(y, stockSeq.length - 1)];
    const bondRet = bondSeq[Math.min(y, bondSeq.length - 1)];
    return { ret: combineReturns(stats, stockRet, bondRet, 2), stockRet, bondRet, cashRet: 2, inflation: inflationFor('worst', y), regime: 'Worst historical' };
  }
  if (mode === 'extreme') {
    const stockSeq = [-50,-28,-12,15,10,8,5];
    const bondSeq = [-15,-8,2,4,5,4,3];
    const stockRet = stockSeq[Math.min(y, stockSeq.length - 1)];
    const bondRet = bondSeq[Math.min(y, bondSeq.length - 1)];
    const inf = inflationFor('extreme', y);
    return { ret: combineReturns(stats, stockRet, bondRet, Math.min(4.5, inf * 0.5 + 1)), stockRet, bondRet, cashRet: Math.min(4.5, inf * 0.5 + 1), inflation: inf, regime: 'Extreme' };
  }
  return regimeReturn(rand, stats, y);
}
export function runSinglePath(config, loans, portfolio, seed = 1234, startDelay = 0) {
  const rand = seededRandom(seed + startDelay * 1000);
  const years = config.retirementYears;
  const loanRows = annualLoanSchedule(loans, years + startDelay + 1, config.startYear);
  const stats = portfolioStats(portfolio);
  const householdIncome = config.incomeSelf + config.incomeSpouse;
  const tax = estimateTax(householdIncome, config.effectiveTaxByIncome);
  const afterTaxIncome = householdIncome - tax;
  let assets = config.investableAssets;
  let living = config.annualLivingExpense;
  const rows = [];
  let markovState = 'Normal';
  for (let y = 0; y < years + startDelay; y++) {
    const market = modeReturn(config.marketMode, stats, y, rand, markovState);
    if (market.nextRegime) markovState = market.nextRegime;
    const loan = loanRows[y] || { loanPayment: 0, loanBalance: 0 };
    const beginAssets = assets;
    const totalSpendingBefore = living + loan.loanPayment;
    const withdrawalRateBefore = beginAssets > 0 ? totalSpendingBefore / beginAssets * 100 : 999;
    const freeze = shouldFreezeCola(config, market.inflation, market.stockRet, market.bondRet, withdrawalRateBefore);
    if (y > 0) living = livingExpenseByStrategy(living, y, market.inflation, config.spendingStrategy, freeze);
    const totalSpending = living + loan.loanPayment;
    const investmentReturn = beginAssets * market.ret / 100;
    const contribution = y < startDelay ? Math.max(0, afterTaxIncome - totalSpending) : 0;
    assets = Math.max(0, beginAssets + investmentReturn + contribution - totalSpending);
    rows.push({
      year: config.startYear + y,
      age: config.age + y,
      beginAssets,
      assets,
      living,
      loanPayment: loan.loanPayment,
      loanBalance: loan.loanBalance,
      totalSpending,
      withdrawalRate: beginAssets > 0 ? totalSpending / beginAssets * 100 : 999,
      investmentReturn,
      contribution,
      ret: market.ret,
      stockRet: market.stockRet,
      bondRet: market.bondRet,
      cashRet: market.cashRet,
      inflation: market.inflation,
      freeze,
      regime: market.regime
    });
  }
  return rows;
}
export function simulate(config, loans, portfolio, runs = 600, seedBase = 202600) {
  const paths = [];
  let successes = 0;
  for (let i = 0; i < runs; i++) {
    const rows = runSinglePath(config, loans, portfolio, seedBase + i * 17, 0);
    paths.push(rows);
    if (rows[rows.length - 1]?.assets > 0 && rows.every(r => r.assets > 0)) successes++;
  }
  const years = config.retirementYears;
  const percentiles = [];
  for (let y = 0; y < years; y++) {
    const vals = paths.map(p => p[y]?.assets || 0).sort((a, b) => a - b);
    const pick = p => vals[Math.min(vals.length - 1, Math.max(0, Math.floor((vals.length - 1) * p)))];
    percentiles.push({ year: config.startYear + y, p10: pick(0.10), p50: pick(0.50), p60: pick(0.60) });
  }
  return { successRate: successes / runs * 100, percentiles, sample: paths[0], safemax: safemaxFromCAPE(config.cape, config.retirementYears), stats: portfolioStats(portfolio) };
}
export function timingOptimizer(config, loans, portfolio, options = {}) {
  const runs = options.runs ?? 600;
  const seedBase = options.seedBase ?? 202600;
  const out = [];
  for (let delay = 0; delay <= 10; delay++) {
    const cfg = { ...config };
    let success = 0;
    const firstWRs = [];
    for (let i = 0; i < runs; i++) {
      const rows = runSinglePath(cfg, loans, portfolio, seedBase + i * 17, delay);
      const retireRow = rows[delay] || rows[0];
      firstWRs.push(retireRow.withdrawalRate);
      const retirementRows = rows.slice(delay);
      if (retirementRows.every(r => r.assets > 0) && retirementRows[retirementRows.length - 1]?.assets > 0) success++;
    }
    out.push({ year: config.startYear + delay, age: config.age + delay, successRate: success / runs * 100, firstWithdrawalRate: firstWRs.reduce((a, b) => a + b, 0) / firstWRs.length });
  }
  return out;
}
export function decisionMatrix(config, loans, portfolio, scenarios, options = {}) {
  const runs = options.runs ?? 600;
  const seedBase = options.seedBase ?? 202600;
  return scenarios.map(s => {
    const cfg = { ...config, investableAssets: s };
    const sim = simulate(cfg, loans, portfolio, runs, seedBase);
    const first = sim.sample[0];
    let advice = '🔴 不建議';
    if (sim.successRate >= 96) advice = '🟢 建議';
    else if (sim.successRate >= 92) advice = '🟡 可考慮';
    return { assets: s, firstWithdrawalRate: first.withdrawalRate, successRate: sim.successRate, safemax: sim.safemax, advice };
  });
}
