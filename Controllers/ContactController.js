const ContactSubmission = require('../Models/ContactModel');
const sendEmail = require('../utils/sendEmail');

// Submit contact form
const submitContactForm = async (req, res) => {
  try {
    const { name, email, phone, subject, message, userId, isRegisteredUser } = req.body;

    // Validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Name, email, subject, and message are required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        status: 'error',
        message: 'Please provide a valid email address'
      });
    }

    // Create contact submission
    const contactSubmission = new ContactSubmission({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : null,
      subject: subject.trim(),
      message: message.trim(),
      userId: userId || null,
      isRegisteredUser: isRegisteredUser || false,
      status: 'new',
      submittedAt: new Date()
    });

    await contactSubmission.save();

    // Send email notification to admin
    try {
      await sendEmail({
        email: 'mrhks145@gmail.com',
        subject: `New Contact Form Submission: ${subject}`,
        message: `
          New contact form submission received:
          
          Name: ${name}
          Email: ${email}
          Phone: ${phone || 'Not provided'}
          Subject: ${subject}
          User Type: ${isRegisteredUser ? 'Registered User' : 'Guest'}
          User ID: ${userId || 'N/A'}
          
          Message:
          ${message}
          
          Submitted at: ${new Date().toLocaleString()}
        `
      });

      // Send confirmation email to user
      await sendEmail({
        email: email,
        subject: 'Thank you for contacting SNAZZY',
        message: `
          Dear ${name},
          
          Thank you for contacting SNAZZY! We have received your message and will get back to you within 24 hours.
          
          Your submission details:
          Subject: ${subject}
          Submitted at: ${new Date().toLocaleString()}
          
          Best regards,
          SNAZZY Customer Support Team
        `
      });
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the entire request if email fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Contact form submitted successfully',
      submissionId: contactSubmission._id
    });

  } catch (error) {
    console.error('Contact form submission error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error. Please try again later.'
    });
  }
};

// Get contact submissions (Admin only)
const getContactSubmissions = async (req, res) => {
  try {
    const submissions = await ContactSubmission.find()
      .sort({ submittedAt: -1 })
      .populate('userId', 'name email role');

    res.status(200).json({
      status: 'success',
      submissions
    });
  } catch (error) {
    console.error('Get contact submissions error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch contact submissions'
    });
  }
};

// Update contact submission status (Admin only)
const updateContactStatus = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { status, adminNotes } = req.body;

    const submission = await ContactSubmission.findById(submissionId);
    if (!submission) {
      return res.status(404).json({
        status: 'error',
        message: 'Contact submission not found'
      });
    }

    submission.status = status || submission.status;
    submission.adminNotes = adminNotes || submission.adminNotes;
    submission.updatedAt = new Date();

    await submission.save();

    res.status(200).json({
      status: 'success',
      message: 'Contact submission updated successfully',
      submission
    });
  } catch (error) {
    console.error('Update contact status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update contact submission'
    });
  }
};

module.exports = {
  submitContactForm,
  getContactSubmissions,
  updateContactStatus
};
