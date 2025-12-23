const Register = require("../Models/UserModel");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const jwt = require("jsonwebtoken");

const addUsers = async (req, res, next) => {
  if (!req.body) {
    return res.status(400).json({ message: "Request body is missing" });
  }

  const { name, gmail, password, age, address, role } = req.body;

  if (!name || !gmail || !password || !age || !address || !role) {
    return res.status(400).json({ message: "All fields are required" });
  }

  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(gmail)) {
    return res.status(400).json({ message: "Invalid email address" });
  }

  const validRoles = [
    "customer",
    "admin",
    "product_manager",
    "order_manager",
    "promotion_manager"
    
  ];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ 
      message: `Invalid role. Allowed values are: ${validRoles.join(", ")}`
    });
  }

  try {
    const existingUser = await Register.findOne({ gmail });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    
    const customer = await stripe.customers.create({
      email: gmail,
      name,
    });

    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new Register({
      name,
      gmail,
      password: hashedPassword,
      age,
      address,
      role,
      stripeCustomerId: customer.id, // save Stripe ID
    });

    await user.save();

    // Send welcome email (fire-and-forget; does not block response)
    try {
      await sendEmail({
        email: gmail,
        subject: "Welcome to Snazzy!",
        message: `Hi ${name},\n\nWelcome to Snazzy! Your account has been created successfully.\n\nHere are a few tips to get started:\n- Browse products and add items to your cart\n- Track your orders in your account\n- Reach out via Contact Us if you need help\n\nThanks for joining us!\n\n— The Snazzy Team`
      });
    } catch (emailErr) {
      // Log email failure but do not fail signup
      console.error("Failed to send welcome email:", emailErr);
    }

    return res.status(201).json({ message: "ok", user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error while adding user" });
  }
};


const getAllUsers = async (req, res, next) => {
    try {
        const users = await Register.find().select("-password");
        if (!users || users.length === 0) {
            return res.status(404).json({ message: "No users found" });
        }
        return res.status(200).json({ users });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error while fetching users" });
    }
};

const getById = async (req, res, next) => {
    const id = req.params.id;

    let user;
    try {
        user = await Register.findById(id).select("-password");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.status(200).json({ user });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error while fetching user" });
    }
};

const updateUser = async (req, res, next) => {
  const userId = req.params.id;
  const { name, gmail, password, age, address, role } = req.body;

  try {
    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    
    if (name) user.name = name;
    if (gmail) user.gmail = gmail;
    if (password) user.password = await bcrypt.hash(password, 10);
    if (age) user.age = age;
    if (address) user.address = address;
    if (role) user.role = role;

    
    if (user.stripeCustomerId) {
      await stripe.customers.update(user.stripeCustomerId, {
        email: gmail || user.gmail,
        name: name || user.name,
      });
    }

    await user.save();

    return res.status(200).json({ message: "User updated successfully", user });
  } catch (err) {
    console.error("Error updating user:", err);
    return res.status(500).json({ message: "Server error while updating user" });
  }
};

const deleteUser = async (req, res, next) => {
    const id = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
    }

    let user;
    try {
        user = await Register.findByIdAndDelete(id).select("-password");
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.status(200).json({ message: "User deleted successfully", user });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error while deleting user" });
    }
};




const loginUser = async (req, res, next) => {
    if (!req.body) {
        return res.status(400).json({ status: "error", err: "Request body is missing" });
    }

    const { gmail, password } = req.body;

    if (!gmail || !password) {
        return res.status(400).json({ status: "error", err: "Email and password are required" });
    }

    try {
        const user = await Register.findOne({ gmail }).select("+password");
        if (!user) {
            return res.status(401).json({ status: "error", err: "Invalid email or password" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ status: "error", err: "Invalid email or password" });
        }

        
        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET || "yoursecretkey",
            { expiresIn: "1h" }
        );

        return res.status(200).json({
            status: "ok",
            token,
            name: user.name,
            role: user.role
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: "error", err: "Server error while logging in" });
    }
};




const forgotPassword = async (req, res) => {
  const { gmail } = req.body;
  const user = await Register.findOne({ gmail });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const resetURL = `http://localhost:3000/reset-password/${resetToken}`;


  try {
    await sendEmail({
      email: user.gmail,
      subject: "Password Reset",
      message: `You requested a password reset. Click here to reset: ${resetURL}`,
    });

    res.status(200).json({ message: "Password reset link sent to email" });
  } catch (err) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    res.status(500).json({ message: "Error sending email" });
  }
};


const resetPassword = async (req, res) => {
  const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

  const user = await Register.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json({ message: "Token invalid or expired" });
  }

  user.password = await bcrypt.hash(req.body.password, 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.status(200).json({ message: "Password reset successful" });
};

exports.addUsers = addUsers;
exports.getAllUsers = getAllUsers;
exports.getById = getById;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
exports.loginUser = loginUser;








const Order = require("../Models/OrderModel");


const updateLoyaltyPoints = async (userId) => {
  const orderCount = await Order.countDocuments({ userId });
  await Register.findByIdAndUpdate(userId, { loyaltyPoints: orderCount });
};

exports.updateLoyaltyPoints = updateLoyaltyPoints;


const getCurrentUser = async (req, res) => {
  try {
    const currentUser = await Register.findById(req.user.id).select("-password");
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({ user: currentUser });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error while fetching current user" });
  }
};


const updateUserWithAuth = async (req, res, next) => {
  try {
    const requesterId = req.user && req.user.id;
    const requesterRole = req.user && req.user.role;
    const targetId = req.params.id;

    if (requesterRole === 'admin' || requesterId === targetId) {
      return updateUser(req, res, next);
    }

    return res.status(403).json({ message: "You can only update your own account" });
  } catch (err) {
    return res.status(500).json({ message: "Server error while updating user" });
  }
};


const deleteUserWithAuth = async (req, res, next) => {
  try {
    const requesterId = req.user && req.user.id;
    const requesterRole = req.user && req.user.role;
    const targetId = req.params.id;

   
    if (requesterRole === 'admin') {
      return deleteUser(req, res, next);
    }

    
    if (requesterRole === 'customer' && requesterId === targetId) {
      return deleteUser(req, res, next);
    }

    return res.status(403).json({ message: "Forbidden: you cannot delete this account" });
  } catch (err) {
    return res.status(500).json({ message: "Server error while deleting user" });
  }
};


exports.forgotPassword = forgotPassword;
exports.resetPassword = resetPassword;
exports.getCurrentUser = getCurrentUser;
exports.updateUserWithAuth = updateUserWithAuth;
exports.deleteUserWithAuth = deleteUserWithAuth;