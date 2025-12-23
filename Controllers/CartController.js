const Cart = require("../Models/CartModel");
const Register = require("../Models/UserModel");

// Get user's cart
const getCart = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    let cart = await Cart.findOne({ userId }).populate('userId', 'username email');
    
    if (!cart) {
      // Create empty cart for user if it doesn't exist
      cart = new Cart({ userId, items: [] });
      await cart.save();
    }

    return res.status(200).json({ cart });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error fetching cart" });
  }
};

// Add item to cart
const addToCart = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const {
      product_id,
      pname,
      pcode,
      pamount,
      image,
      quantity = 1,
      selectedSize,
      selectedColor,
      variant,
      hasActivePromotion = false,
      discountedPrice,
      promotion
    } = req.body;

    // Validate required fields
    if (!product_id || !pname || !pcode || !pamount) {
      return res.status(400).json({ 
        message: "Missing required fields: product_id, pname, pcode, pamount" 
      });
    }

    // Find or create cart for user
    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    // Check if item already exists in cart with same variants
    const existingItemIndex = cart.items.findIndex(item => 
      item.product_id === product_id && 
      item.selectedSize === selectedSize && 
      item.selectedColor === selectedColor
    );

    if (existingItemIndex !== -1) {
      // Update quantity of existing item
      cart.items[existingItemIndex].quantity += quantity;
    } else {
      // Add new item to cart
      const newItem = {
        product_id,
        pname,
        pcode,
        pamount,
        image,
        quantity,
        selectedSize,
        selectedColor,
        variant,
        hasActivePromotion,
        discountedPrice,
        promotion
      };
      cart.items.push(newItem);
    }

    await cart.save();

    return res.status(200).json({ 
      message: "Item added to cart successfully",
      cart 
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error adding item to cart" });
  }
};

// Update item quantity in cart
const updateCartItem = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    if (!quantity || quantity < 0) {
      return res.status(400).json({ message: "Invalid quantity" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ message: "Item not found in cart" });
    }

    if (quantity === 0) {
      // Remove item from cart
      cart.items.splice(itemIndex, 1);
    } else {
      // Update quantity
      cart.items[itemIndex].quantity = quantity;
    }

    await cart.save();

    return res.status(200).json({ 
      message: "Cart updated successfully",
      cart 
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error updating cart item" });
  }
};

// Remove item from cart
const removeFromCart = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { itemId } = req.params;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const itemIndex = cart.items.findIndex(item => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ message: "Item not found in cart" });
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();

    return res.status(200).json({ 
      message: "Item removed from cart successfully",
      cart 
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error removing item from cart" });
  }
};

// Clear entire cart
const clearCart = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = [];
    await cart.save();

    return res.status(200).json({ 
      message: "Cart cleared successfully",
      cart 
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error clearing cart" });
  }
};

// Get cart item count
const getCartItemCount = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const cart = await Cart.findOne({ userId });
    const itemCount = cart ? cart.items.reduce((total, item) => total + item.quantity, 0) : 0;

    return res.status(200).json({ itemCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error getting cart item count" });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getCartItemCount
};
