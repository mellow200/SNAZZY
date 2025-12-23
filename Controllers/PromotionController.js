const Promotion = require("../Models/PromotionModel");

// Get all promotions
const getAllPromotions = async (req, res) => {
  try {
    const promotions = await Promotion.find();
    if (!promotions || promotions.length === 0) {
      return res.status(404).json({ message: "No promotions found" });
    }
    return res.status(200).json({ promotions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error fetching promotions" });
  }
};

// Add new promotion with image
const addPromotions = async (req, res) => {
  const { title, productId, description, discount, startDate, endDate } = req.body;

  if (!title || !productId || discount === undefined || !startDate || !endDate) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  try {
    let bannerImage = null;
    if (req.file) {
      bannerImage = `/uploads/${req.file.filename}`; // store file URL
    }

    const createdPromotion = new Promotion({
      title,
      productId,
      description,
      discount,
      startDate,
      endDate,
      bannerImage,
    });

    await createdPromotion.save();
    return res.status(201).json({ promotion: createdPromotion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || "Unable to add promotion" });
  }
};

// Update promotion with optional image
const updatePromotion = async (req, res) => {
  const id = req.params.id;
  const { title, productId, description, discount, startDate, endDate } = req.body;

  try {
    let updateData = { title, productId, description, discount, startDate, endDate };

    if (req.file) {
      updateData.bannerImage = `/uploads/${req.file.filename}`;
    }

    const updatedPromotion = await Promotion.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedPromotion) {
      return res.status(404).json({ message: "Unable to update promotion" });
    }

    return res.status(200).json({ promotion: updatedPromotion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error updating promotion" });
  }
};

// Get promotion by ID
const getById = async (req, res) => {
  const id = req.params.id;
  try {
    const promotion = await Promotion.findById(id);
    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }
    return res.status(200).json({ promotion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error fetching promotion" });
  }
};

// Delete promotion
const deletePromotion = async (req, res) => {
  const id = req.params.id;
  try {
    const deletedPromotion = await Promotion.findByIdAndDelete(id);
    if (!deletedPromotion) {
      return res.status(404).json({ message: "Unable to delete promotion" });
    }
    return res.status(200).json({ promotion: deletedPromotion });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error deleting promotion" });
  }
};

module.exports = {
  getAllPromotions,
  addPromotions,
  getById,
  updatePromotion,
  deletePromotion,
};
