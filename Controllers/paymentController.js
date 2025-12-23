const Stripe = require('stripe');
const PaymentMethod = require('../Models/PaymentMethod');
const Payment = require('../Models/Payment');
const Register = require('../Models/UserModel');
const sendEmail = require('../utils/sendEmail');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// PDF generation imports
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

// Add a card
exports.addCard = async (req, res) => {
  const { paymentMethodId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'User not authenticated' });
  if (!paymentMethodId) return res.status(400).json({ message: 'paymentMethodId required' });

  try {
    const user = await Register.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.gmail, name: user.name });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });

    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

    const existing = await PaymentMethod.findOne({ stripePaymentMethodId: paymentMethodId });
    if (existing) return res.status(400).json({ message: 'Card already added' });

    const newCard = new PaymentMethod({
      userId,
      stripeCustomerId: customerId,
      stripePaymentMethodId: paymentMethodId,
      cardBrand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    });

    await newCard.save();
    res.status(200).json({ message: 'Card added', paymentMethod: newCard });

  } catch (err) {
    console.error('Stripe/AddCard error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};


// Get all cards
exports.getCards = async (req, res) => {
  const userId = req.user.id;
  try {
    const cards = await PaymentMethod.find({ userId });
    res.status(200).json({ paymentMethods: cards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get single card
exports.getCard = async (req, res) => {
  const userId = req.user.id;
  const { cardId } = req.params;
  try {
    const card = await PaymentMethod.findOne({ _id: cardId, userId });
    if (!card) return res.status(404).json({ message: 'Card not found' });
    res.status(200).json(card);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update card
exports.updateCard = async (req, res) => {
  const userId = req.user.id;
  const { cardId } = req.params;
  const { paymentMethodId } = req.body;

  if (!paymentMethodId) return res.status(400).json({ message: 'paymentMethodId required' });

  try {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const updated = await PaymentMethod.findOneAndUpdate(
      { _id: cardId, userId },
      { 
        stripePaymentMethodId: paymentMethodId, 
        cardBrand: pm.card.brand, 
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year
      },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: 'Card not found' });
    res.status(200).json({ message: 'Card updated', paymentMethod: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete card
exports.deleteCard = async (req, res) => {
  const userId = req.user.id;
  const { cardId } = req.params;

  // Validate cardId format
  if (!cardId || cardId.length !== 24) {
    return res.status(400).json({ message: 'Invalid card ID format' });
  }

  try {
    // Find the card
    const card = await PaymentMethod.findOne({ _id: cardId, userId });
    if (!card) {
      return res.status(404).json({ message: 'Card not found' });
    }

    // Detach card from Stripe
    try {
      await stripe.paymentMethods.detach(card.stripePaymentMethodId);
    } catch (stripeError) {
      // Log only the error message, not the full error object
      console.log('Stripe detach warning:', stripeError.message || 'Payment method may already be detached');
      // Continue with database deletion even if Stripe fails
      // This handles cases where the payment method was already detached
    }

    // Delete from database
    await card.deleteOne();
    
    res.status(200).json({ message: 'Card deleted successfully' });
  } catch (err) {
    console.error('Delete card error:', err);
    
    // Handle specific error types
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid card ID format' });
    }
    
    if (err.name === 'ValidationError') {
      return res.status(400).json({ message: 'Validation error: ' + err.message });
    }
    
    // Generic server error
    res.status(500).json({ message: 'Server error: ' + err.message });
  }
};

// Create payment
exports.createPayment = async (req, res) => {
  const userId = req.user?.id;
  const { amount, paymentMethodId, orderData } = req.body;

  if (!userId) return res.status(401).json({ message: 'User not authenticated' });
  if (!amount || !paymentMethodId) return res.status(400).json({ message: 'amount & paymentMethodId required' });

  try {
    const user = await Register.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const pm = await PaymentMethod.findOne({ userId, stripePaymentMethodId: paymentMethodId });
    if (!pm) return res.status(400).json({ message: 'Invalid payment method' });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: user.stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
    });

    const payment = new Payment({
      userId,
      amount,
      stripePaymentId: paymentIntent.id,
      currency: 'usd',
      status: paymentIntent.status,
    });
    await payment.save();

    // Send PDF invoice email after successful payment
    if (paymentIntent.status === 'succeeded' && orderData) {
      try {
        await sendPDFInvoiceEmail(user, payment, orderData, pm);
      } catch (emailError) {
        console.error('PDF Invoice email failed:', emailError);
        // Don't fail the payment if email fails
      }
    }

    res.status(200).json({
      message: 'Payment successful',
      payment,
      clientSecret: paymentIntent.client_secret,
      paymentIntentStatus: paymentIntent.status,
    });

  } catch (err) {
    console.error('CreatePayment error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
};

// Get all payments for the logged-in user
exports.getPayments = async (req, res) => {
  const userId = req.user?.id; // from JWT middleware

  if (!userId) {
    return res.status(401).json({ message: 'User not authenticated' });
  }

  try {
    const payments = await Payment.find({ userId }).sort({ createdAt: -1 });
    res.status(200).json({ payments });
  } catch (err) {
    console.error('Fetch payments error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Function to generate and send PDF invoice email
const sendPDFInvoiceEmail = async (user, payment, orderData, paymentMethod) => {
  const { 
    product_name, 
    size, 
    quantity, 
    total_price, 
    base_price, 
    promotion_discount, 
    promotion_title,
    loyalty_discount,
    customer_address,
    customer_name
  } = orderData;

  const invoiceNumber = `INV-${payment._id.toString().slice(-8).toUpperCase()}`;
  const paymentDate = new Date(payment.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Generate PDF
  const pdfBuffer = await generateInvoicePDF({
    invoiceNumber,
    paymentDate,
    customerName: customer_name || user.name,
    customerEmail: user.gmail,
    customerAddress: customer_address,
    productName: product_name,
    size: size,
    quantity: quantity,
    basePrice: base_price,
    promotionDiscount: promotion_discount,
    promotionTitle: promotion_title,
    loyaltyDiscount: loyalty_discount,
    totalPrice: total_price,
    paymentId: payment.stripePaymentId,
    paymentAmount: payment.amount
  });

  // Send email with PDF attachment
  await sendEmailWithPDF({
    email: user.gmail,
    subject: `Invoice #${invoiceNumber} - Payment Confirmation`,
    message: `
Dear ${customer_name || user.name},

Thank you for your purchase! Your payment has been successfully processed.

Please find your invoice attached as a PDF document.

Invoice Details:
- Invoice Number: ${invoiceNumber}
- Payment Date: ${paymentDate}
- Amount Paid: $${payment.amount.toFixed(2)}
- Payment Method: Card ending in ${paymentMethod.last4}

Your order is being processed and will be shipped to:
${customer_address}

Best regards,
SNAZZY Team
    `,
    pdfBuffer: pdfBuffer,
    filename: `Invoice_${invoiceNumber}.pdf`
  });
};

// Function to generate PDF invoice
const generateInvoicePDF = async (data) => {
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.text('SNAZZY', 20, 30);
  doc.text('INVOICE', 20, 40);
  
  // Invoice details
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Invoice #: ${data.invoiceNumber}`, 20, 55);
  doc.text(`Date: ${data.paymentDate}`, 20, 60);
  doc.text(`Payment ID: ${data.paymentId}`, 20, 65);
  
  // Customer details
  doc.text('Bill To:', 20, 80);
  doc.text(data.customerName, 20, 85);
  doc.text(data.customerEmail, 20, 90);
  doc.text(data.customerAddress, 20, 95);
  
  // Product details section
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('Product Details:', 20, 115);
  
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Product: ${data.productName}`, 20, 125);
  doc.text(`Size: ${data.size}`, 20, 130);
  doc.text(`Quantity: ${data.quantity}`, 20, 135);
  doc.text(`Unit Price: $${data.basePrice.toFixed(2)}`, 20, 140);
  
  // Draw a simple line
  doc.line(20, 145, 190, 145);
  
  // Calculate totals
  const subtotal = data.basePrice * data.quantity;
  let currentY = 155;
  
  doc.text(`Subtotal: $${subtotal.toFixed(2)}`, 150, currentY);
  
  if (data.promotionDiscount > 0) {
    currentY += 5;
    doc.text(`Promotion Discount (${data.promotionTitle}): -$${data.promotionDiscount.toFixed(2)}`, 150, currentY);
  }
  
  if (data.loyaltyDiscount > 0) {
    currentY += 5;
    doc.text(`Loyalty Discount: -$${data.loyaltyDiscount.toFixed(2)}`, 150, currentY);
  }
  
  currentY += 10;
  doc.setFont(undefined, 'bold');
  doc.text(`Total: $${data.totalPrice.toFixed(2)}`, 150, currentY);
  
  // Footer
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  doc.text('Thank you for your business!', 20, currentY + 20);
  doc.text('For support, contact us at support@snazzy.com', 20, currentY + 25);
  
  return doc.output('arraybuffer');
};

// Function to send email with PDF attachment
const sendEmailWithPDF = async (options) => {
  const nodemailer = require("nodemailer");
  
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: "Snazzy App <no-reply@snazzy.com>",
    to: options.email,
    subject: options.subject,
    text: options.message,
    attachments: [
      {
        filename: options.filename,
        content: Buffer.from(options.pdfBuffer),
        contentType: 'application/pdf'
      }
    ]
  };

  await transporter.sendMail(mailOptions);
};

