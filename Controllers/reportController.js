const Payment = require('../Models/Payment');
const RefundRequest = require('../Models/RefundRequest');

function getMonthRange(year, month) {
  // month: 1-12
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

exports.getMonthlyFinancialReport = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getUTCFullYear();
    const month = Number(req.query.month) || (now.getUTCMonth() + 1); // 1-12

    const { start, end } = getMonthRange(year, month);

    // Last month range
    const lastMonth = month === 1 ? 12 : month - 1;
    const lastYear = month === 1 ? year - 1 : year;
    const { start: lastStart, end: lastEnd } = getMonthRange(lastYear, lastMonth);

    // Payments in month
    const paymentsAgg = await Payment.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const totalPaymentsAmount = paymentsAgg[0]?.totalAmount || 0;
    const totalPaymentsCount = paymentsAgg[0]?.count || 0;

    // Refund requests in month by status (createdAt window)
    const refundsAgg = await RefundRequest.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const refundCountsMap = refundsAgg.reduce((acc, r) => { acc[r._id] = r.count; return acc; }, {});
    const refundApprovedCount = refundCountsMap['approved'] || 0;
    const refundRejectedCount = refundCountsMap['rejected'] || 0;
    const refundTotalCount = (refundCountsMap['pending'] || 0) + refundApprovedCount + refundRejectedCount;

    // Approved refund amount in month: sum linked payment amounts for requests created this month and approved
    const approvedRefundsWithPayment = await RefundRequest.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: start, $lte: end } } },
      { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id', as: 'payment' } },
      { $unwind: '$payment' },
      { $group: { _id: null, totalRefundAmount: { $sum: '$payment.amount' } } },
    ]);
    const totalApprovedRefundAmount = approvedRefundsWithPayment[0]?.totalRefundAmount || 0;

    const netIncome = Number((totalPaymentsAmount - totalApprovedRefundAmount).toFixed(2));

    // Last month net income
    const lastPaymentsAgg = await Payment.aggregate([
      { $match: { createdAt: { $gte: lastStart, $lte: lastEnd } } },
      { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
    ]);
    const lastTotalPaymentsAmount = lastPaymentsAgg[0]?.totalAmount || 0;
    const lastApprovedRefundsWithPayment = await RefundRequest.aggregate([
      { $match: { status: 'approved', createdAt: { $gte: lastStart, $lte: lastEnd } } },
      { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id', as: 'payment' } },
      { $unwind: '$payment' },
      { $group: { _id: null, totalRefundAmount: { $sum: '$payment.amount' } } },
    ]);
    const lastTotalApprovedRefundAmount = lastApprovedRefundsWithPayment[0]?.totalRefundAmount || 0;
    const lastNetIncome = Number((lastTotalPaymentsAmount - lastTotalApprovedRefundAmount).toFixed(2));

    const incomeDelta = Number((netIncome - lastNetIncome).toFixed(2));

    return res.status(200).json({
      context: { year, month },
      generatedAt: new Date(),
      totals: {
        totalPaymentsAmount: Number(totalPaymentsAmount.toFixed(2)),
        totalPaymentsCount,
        refundApprovedCount,
        refundRejectedCount,
        refundTotalCount,
        totalApprovedRefundAmount: Number(totalApprovedRefundAmount.toFixed(2)),
        netIncome,
        lastNetIncome,
        incomeDelta,
      },
    });
  } catch (err) {
    console.error('Monthly financial report error:', err);
    res.status(500).json({ message: 'Server error while generating monthly report' });
  }
};


