export function marginalBenefit(matrix) {
  const out=[];
  for (let i=1;i<matrix.length;i++) {
    const prev=matrix[i-1], cur=matrix[i];
    out.push({ from: prev.assets, to: cur.assets, successGain: cur.successRate-prev.successRate, withdrawalDrop: prev.firstWithdrawalRate-cur.firstWithdrawalRate });
  }
  return out;
}
