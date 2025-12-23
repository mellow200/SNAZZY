const Stripe = require('stripe');
const Payment = require('../Models/Payment');
const RefundRequest = require('../Models/RefundRequest');
const Register = require('../Models/UserModel');
const Order = require('../Models/OrderModel');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { jsPDF } = require('jspdf');

// Step 1: User creates refund request
exports.createRefundRequest = async (req, res) => {
  const { paymentId } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;

  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Check if already requested
    const existing = await RefundRequest.findOne({ paymentId, userId });
    if (existing) {
      return res.status(400).json({ message: 'Refund already requested for this payment' });
    }

    const refundRequest = new RefundRequest({
      userId,
      paymentId,
      reason,
      status: 'pending'
    });
    await refundRequest.save();

    res.status(201).json({ message: 'Refund request submitted', refundRequest });
  } catch (err) {
    console.error('Refund request error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// Step 2: Admin approves/rejects
exports.handleRefund = async (req, res) => {
  const { requestId } = req.params;
  const { action, response } = req.body; // action = "approve" | "reject"
  
  try {
    const refundRequest = await RefundRequest.findById(requestId).populate('paymentId');
    if (!refundRequest) {
      return res.status(404).json({ message: 'Refund request not found' });
    }

    if (refundRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Refund already processed' });
    }

    if (action === 'approve') {
      const refund = await stripe.refunds.create({
        payment_intent: refundRequest.paymentId.stripePaymentId,
      });

      refundRequest.status = 'approved';
      refundRequest.adminResponse = response || 'Approved';
      await refundRequest.save();

      // Delete the associated order when refund is approved
      try {
        // Find order by payment_id since that's how they're linked
        const orderToDelete = await Order.findOne({ payment_id: refundRequest.paymentId._id });
        if (orderToDelete) {
          await Order.findByIdAndDelete(orderToDelete._id);
          console.log(`Order ${orderToDelete._id} deleted due to refund approval`);
          
          // Update user loyalty points when order is deleted
          if (orderToDelete.userId) {
            const user = await Register.findById(orderToDelete.userId);
            if (user) {
              user.loyaltyPoints = Math.max((user.loyaltyPoints || 0) - 5, 0);
              await user.save();
              console.log(`Updated loyalty points for user ${orderToDelete.userId}`);
            }
          }
        } else {
          console.log(`No order found with payment_id: ${refundRequest.paymentId._id}`);
        }
      } catch (orderDeletionError) {
        console.error('Error deleting order after refund approval:', orderDeletionError);
        // Don't fail the refund approval if order deletion fails
      }

      // Send approval email with PDF
      try {
        const user = await Register.findById(refundRequest.userId);
        if (user) {
          await sendRefundApprovalEmail(user, refundRequest, refund);
        }
      } catch (emailError) {
        console.error('Refund approval email failed:', emailError);
      }

      return res.status(200).json({ message: 'Refund approved', refund, refundRequest });
    } else if (action === 'reject') {
      refundRequest.status = 'rejected';
      refundRequest.adminResponse = response || 'Rejected due to suspicious activity';
      await refundRequest.save();

      // Send rejection email with PDF
      try {
        const user = await Register.findById(refundRequest.userId);
        if (user) {
          await sendRefundRejectionEmail(user, refundRequest);
        }
      } catch (emailError) {
        console.error('Refund rejection email failed:', emailError);
      }

      return res.status(200).json({ message: 'Refund rejected', refundRequest });
    } else {
      return res.status(400).json({ message: 'Invalid action' });
    }
  } catch (err) {
    console.error('Handle refund error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// Step 3: User can view their refund requests
exports.getUserRefunds = async (req, res) => {
  const userId = req.user.id;
  try {
    const refunds = await RefundRequest.find({ userId }).populate('paymentId');
    res.status(200).json({ refunds });
  } catch (err) {
    console.error('Get refunds error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Step 4: Admin can view all refund requests
exports.getAllRefunds = async (req, res) => {
  try {
    const refunds = await RefundRequest.find().populate('paymentId');
    res.status(200).json({ refunds });
  } catch (err) {
    console.error('Get all refunds error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Helper: send refund approval email with PDF
const sendRefundApprovalEmail = async (user, refundRequest, stripeRefund) => {
  const refundNumber = `REF-${refundRequest._id.toString().slice(-8).toUpperCase()}`;
  const approvalDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const pdfBuffer = await generateRefundApprovalPDF({
    refundNumber,
    approvalDate,
    customerName: user.name,
    customerEmail: user.gmail,
    originalAmount: refundRequest.paymentId.amount,
    refundAmount: (stripeRefund.amount / 100).toFixed(2),
    userReason: refundRequest.reason,
    paymentId: refundRequest.paymentId.stripePaymentId,
    refundId: stripeRefund.id
  });

  await sendEmailWithPDF({
    email: user.gmail,
    subject: `Refund Approved - ${refundNumber}`,
    message: `Dear ${user.name},\n\nYour refund request has been approved. Your refund will be sent to you shortly. Sorry for the inconvenience.\n\nDetails:\n- Refund Number: ${refundNumber}\n- Approval Date: ${approvalDate}\n- Original Amount: $${refundRequest.paymentId.amount.toFixed(2)}\n- Refund Amount: $${(stripeRefund.amount / 100).toFixed(2)}\n- Your Reason: ${refundRequest.reason || 'Not specified'}\n`,
    pdfBuffer,
    filename: `Refund_Approval_${refundNumber}.pdf`
  });
};

// Helper: send refund rejection email with PDF
const sendRefundRejectionEmail = async (user, refundRequest) => {
  const refundNumber = `REF-${refundRequest._id.toString().slice(-8).toUpperCase()}`;
  const rejectionDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const pdfBuffer = await generateRefundRejectionPDF({
    refundNumber,
    rejectionDate,
    customerName: user.name,
    customerEmail: user.gmail,
    originalAmount: refundRequest.paymentId.amount,
    userReason: refundRequest.reason,
    paymentId: refundRequest.paymentId.stripePaymentId,
    adminResponse: refundRequest.adminResponse || 'Rejected due to suspicious activity'
  });

  await sendEmailWithPDF({
    email: user.gmail,
    subject: `Refund Request Rejected - ${refundNumber}`,
    message: `Dear ${user.name},\n\nYour refund request has been rejected due to suspicious activity.\n\nDetails:\n- Refund Number: ${refundNumber}\n- Rejection Date: ${rejectionDate}\n- Original Amount: $${refundRequest.paymentId.amount.toFixed(2)}\n- Your Reason: ${refundRequest.reason || 'Not specified'}\n- Admin Response: ${refundRequest.adminResponse || 'Rejected due to suspicious activity'}\n`,
    pdfBuffer,
    filename: `Refund_Rejection_${refundNumber}.pdf`
  });
};

// Helper: generate approval PDF
const generateRefundApprovalPDF = async (data) => {
  const doc = new jsPDF();
  doc.setFontSize(20); doc.setFont(undefined, 'bold');
  doc.text('SNAZZY', 20, 30); doc.text('REFUND APPROVAL', 20, 40);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Refund #: ${data.refundNumber}`, 20, 55);
  doc.text(`Approval Date: ${data.approvalDate}`, 20, 60);
  doc.text(`Payment ID: ${data.paymentId}`, 20, 65);
  doc.text(`Stripe Refund ID: ${data.refundId}`, 20, 70);
  doc.text('Customer Information:', 20, 85);
  doc.text(`Name: ${data.customerName}`, 20, 90);
  doc.text(`Email: ${data.customerEmail}`, 20, 95);
  doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text('Refund Details:', 20, 115);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Original Amount: $${data.originalAmount}`, 20, 125);
  doc.text(`Refund Amount: $${data.refundAmount}`, 20, 130);
  doc.text(`Customer Reason: ${data.userReason || 'Not specified'}`, 20, 135);
  doc.line(20, 145, 190, 145);
  doc.setFont(undefined, 'bold'); doc.setFontSize(12); doc.text('STATUS: APPROVED', 20, 160);
  // Approval message per requirement
  doc.setFont(undefined, 'normal'); doc.setFontSize(10);
  doc.text('The refund request has been approved. Your refund will be sent to you in a moment.', 20, 175);
  doc.text('Sorry for the inconvenience.', 20, 180);
  return doc.output('arraybuffer');
};

// Helper: generate rejection PDF
const generateRefundRejectionPDF = async (data) => {
  const doc = new jsPDF();
  doc.setFontSize(20); doc.setFont(undefined, 'bold');
  doc.text('SNAZZY', 20, 30); doc.text('REFUND REJECTION', 20, 40);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Refund #: ${data.refundNumber}`, 20, 55);
  doc.text(`Rejection Date: ${data.rejectionDate}`, 20, 60);
  doc.text(`Payment ID: ${data.paymentId}`, 20, 65);
  doc.text('Customer Information:', 20, 85);
  doc.text(`Name: ${data.customerName}`, 20, 90);
  doc.text(`Email: ${data.customerEmail}`, 20, 95);
  doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text('Refund Details:', 20, 115);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Original Amount: $${data.originalAmount}`, 20, 125);
  doc.text(`Customer Reason: ${data.userReason || 'Not specified'}`, 20, 130);
  doc.text(`Admin Response: ${data.adminResponse}`, 20, 135);
  doc.line(20, 145, 190, 145);
  doc.setFont(undefined, 'bold'); doc.setFontSize(12); doc.text('STATUS: REJECTED', 20, 160);
  // Rejection message per requirement
  doc.setFont(undefined, 'normal'); doc.setFontSize(10);
  doc.text('This refund request has been rejected due to suspicious activity.', 20, 175);
  return doc.output('arraybuffer');
};

// Helper: send email with PDF
const sendEmailWithPDF = async (options) => {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
  await transporter.sendMail({
    from: 'Snazzy App <no-reply@snazzy.com>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    attachments: [{ filename: options.filename, content: Buffer.from(options.pdfBuffer), contentType: 'application/pdf' }]
  });
};
