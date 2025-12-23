const Order = require("../Models/OrderModel");
const Register = require("../Models/UserModel");
const Cart = require("../Models/CartModel");


const getAllOrders = async (req, res) => {
    try {
        const orders = await Order.find()
            .populate("product_id")
            .populate("userId", "username email");

        if (!orders || orders.length === 0) {
            return res.status(404).json({ message: "No orders found" });
        }

        return res.status(200).json({ orders });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Error fetching orders" });
    }
};


const addOrders = async (req, res) => {
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
    }

    console.log("Incoming body:", req.body);

    const { customer_name,product_name, customer_address, product_id, size, quantity, payment_type,total_price, payment_id, base_price, loyalty_discount, used_loyalty_points, promotion_discount, has_promotion, promotion_title, promotion_id } = req.body;

    try {
        
        const user = await Register.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const order = new Order({
            userId,
            customer_name,
            product_name,
            customer_address,
            product_id,
            size,
            quantity,
            payment_type,
            total_price,
            base_price: base_price || total_price,
            promotion_discount: promotion_discount || 0,
            has_promotion: has_promotion || false,
            promotion_title: promotion_title || null,
            promotion_id: promotion_id || null,
            loyalty_discount: loyalty_discount || 0,
            used_loyalty_points: used_loyalty_points || false,
            payment_id,
        });

        await order.save();
        
        
        if (used_loyalty_points && user.loyaltyPoints >= 5) {
        
            user.loyaltyPoints = Math.max((user.loyaltyPoints || 0) - 5, 0);
        } else {
            
            user.loyaltyPoints = (user.loyaltyPoints || 0) + 5;
        }
        
        await user.save();

        // Clear user's cart after successful order
        try {
            const userCart = await Cart.findOne({ userId });
            if (userCart) {
                userCart.items = [];
                await userCart.save();
            }
        } catch (cartError) {
            console.error("Error clearing cart after order:", cartError);
            // Don't fail the order if cart clearing fails
        }

        return res.status(201).json({ 
            order, 
            loyaltyPoints: user.loyaltyPoints,
            loyaltyPointsUsed: used_loyalty_points || false,
            loyaltyDiscount: loyalty_discount || 0
        });
        
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Error creating order" });
    }
};


const getById = async (req, res) => {
    const { id } = req.params;

    try {
        const order = await Order.findById(id)
            .populate("product_id")
            .populate("userId", "username email");

        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        return res.status(200).json({ order });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Error fetching order" });
    }
};


const updateOrder = async (req, res) => {
    const { id } = req.params;
    const { customer_name, customer_address, size, quantity, payment_type, payment_id, status } = req.body;

    try {
        const order = await Order.findByIdAndUpdate(
            id,
            { customer_name, customer_address, size, quantity, payment_type, payment_id, status },
            { new: true } 
        );

        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        return res.status(200).json({ order });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to update order" });
    }
};


const deleteOrder = async (req, res) => {
    const { id } = req.params;

    try {
        const order = await Order.findByIdAndDelete(id);

        if (!order) {
            return res.status(404).json({ message: "Order not found, cannot delete" });
        }
        if (order.userId) {
            const user = await Register.findById(order.userId);
            if (user) {
                
                user.loyaltyPoints = Math.max((user.loyaltyPoints || 0) - 5, 0);
                await user.save();
            }
        }

        return res.status(200).json({ message: "Order deleted successfully" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Unable to delete order" });
    }
};
//  all orders for the loggedin user
const getUserOrders = async (req, res) => {
  const userId = req.user?.id; 

  if (!userId) {
    return res.status(401).json({ message: "User not authenticated" });
  }

  try {
    const orders = await Order.find({ userId })
      .populate("product_id"); 

    if (!orders || orders.length === 0) {
      return res.status(404).json({ message: "No orders found for this user" });
    }

    return res.status(200).json({ orders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error fetching user orders" });
  }
};


module.exports = { getAllOrders, addOrders, getById, updateOrder, deleteOrder, getUserOrders };
