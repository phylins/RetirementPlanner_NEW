export function estimateTax(income, table) {
  if (!Array.isArray(table) || table.length === 0) return income * 0.3;
  const sorted = [...table].sort((a,b)=>a.income-b.income);
  if (income <= sorted[0].income) return sorted[0].tax * income / sorted[0].income;
  for (let i=1;i<sorted.length;i++) {
    const a=sorted[i-1], b=sorted[i];
    if (income <= b.income) {
      const t=(income-a.income)/(b.income-a.income);
      return a.tax + t*(b.tax-a.tax);
    }
  }
  const last=sorted[sorted.length-1];
  return last.tax + (income-last.income)*0.42;
}
export function inflationFor(mode, yearIndex) {
  if (mode === 'historical') {
    const seq = [1.1,1.6,2.3,2.9,5.5,3.2,2.1,1.7,3.0,2.4,1.8,4.1,6.2,2.5,1.9];
    return seq[yearIndex % seq.length];
  }
  if (mode === 'worst') {
    const seq = [6.2,11.0,9.1,5.8,3.2,2.7,4.0,2.8,2.1,2.0];
    return seq[Math.min(yearIndex, seq.length-1)];
  }
  if (mode === 'extreme') {
    const seq = [8,7,5,3.5,3,2.5,2.2,2.0];
    return seq[Math.min(yearIndex, seq.length-1)];
  }
  // regime baseline; actual simulation can override
  return [1.8,2.4,2.1,3.2,1.7,5.5,2.6,2.0][yearIndex % 8];
}
export function livingExpenseByStrategy(base, yearIndex, inflation, strategy, dynamicFreeze=false) {
  if (yearIndex === 0) return base;
  if (dynamicFreeze) return base;
  if (strategy === 'classic') return base * (1 + inflation/100);
  if (strategy === 'dynamic') return base * (1 + Math.min(inflation, 2.5)/100);
  if (strategy === 'guardrails') return base * (1 + Math.min(inflation, 2.0)/100);
  // Spending Smile: early small increase, mid flat/decline, late mild medical uptick
  if (yearIndex <= 10) return base * (1 + Math.min(inflation, 1.2)/100);
  if (yearIndex <= 25) return base * (1 - 0.3/100);
  if (yearIndex <= 35) return base * (1 - 0.1/100);
  return base * (1 + 0.8/100);
}
export function safemaxFromCAPE(cape, years=45) {
  let base = 4.5;
  if (cape >= 40) base = 3.25; else if (cape >= 34) base = 3.55; else if (cape >= 28) base = 3.85; else if (cape >= 22) base = 4.15; else base = 4.55;
  if (years > 40) base -= 0.15;
  if (years > 50) base -= 0.15;
  return Math.max(2.8, base);
}
