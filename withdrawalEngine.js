export function monthlyPayment(balance, months, apr) {
  const r = (Number(apr) || 0) / 100 / 12;
  if (!months) return 0;
  if (r === 0) return balance / months;
  return balance * r / (1 - Math.pow(1 + r, -months));
}
export function annualLoanSchedule(loans, years, startYear = 2026) {
  const schedules = loans.map(l => ({ ...l, remaining: l.balance, payment: monthlyPayment(l.balance, l.months, l.apr), monthsLeft: l.months }));
  const rows = [];
  for (let y = 0; y < years; y++) {
    let annualPayment = 0;
    let endingBalance = 0;
    const byLoan = {};
    for (const l of schedules) {
      let paidThisYear = 0;
      for (let m = 0; m < 12 && l.monthsLeft > 0 && l.remaining > 0.5; m++) {
        const r = (Number(l.apr) || 0) / 100 / 12;
        const interest = l.remaining * r;
        const principal = Math.min(l.remaining, Math.max(0, l.payment - interest));
        const pay = principal + interest;
        l.remaining -= principal;
        l.monthsLeft -= 1;
        paidThisYear += pay;
      }
      if (l.remaining < 1) l.remaining = 0;
      annualPayment += paidThisYear;
      endingBalance += l.remaining;
      byLoan[l.name] = { paid: paidThisYear, endingBalance: l.remaining };
    }
    rows.push({ year: startYear + y, loanPayment: annualPayment, loanBalance: endingBalance, byLoan });
  }
  return rows;
}
