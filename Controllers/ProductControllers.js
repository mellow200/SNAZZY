const Product = require("../Models/ProductModel");
const Promotion = require("../Models/PromotionModel");

//Data Insert part
const addProducts = async (req, res) => {
  const { pname, pcode, pamount, pdescription, variants } = req.body;
  
  
  let imagePaths = [];
  let firstImagePath = null;
  
  if (req.files && req.files.length > 0) {
    imagePaths = req.files.map(file => `/uploads/${file.filename}`);
    firstImagePath = imagePaths[0]; 
  } else if (req.file) {
    
    firstImagePath = `/uploads/${req.file.filename}`;
    imagePaths = [firstImagePath];
  }

  try {
    // variants if strings
    let parsedVariants = variants;
    if (typeof variants === 'string') {
      parsedVariants = JSON.parse(variants);
    }

    // Validate 
    if (!parsedVariants || !Array.isArray(parsedVariants) || parsedVariants.length === 0) {
      return res.status(400).json({ message: "At least one variant (size/color combination) is required" });
    }

    // Validate each 
    for (const variant of parsedVariants) {
      if (!variant.size || !variant.color || variant.quantity === undefined) {
        return res.status(400).json({ message: "Each variant must have size, color, and quantity" });
      }
      if (variant.size < 35 || variant.size > 44) {
        return res.status(400).json({ message: "Size must be between 35 and 44" });
      }
    }

    const product = new Product({
      pname,
      pcode,
      pamount,
      pdescription,
      variants: parsedVariants,
      image: firstImagePath, 
      images: imagePaths 
    });
    await product.save();
    return res.status(201).json({ product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Unable to add product" });
  }
};

//Update
const updateProduct = async (req, res) => {
  const id = req.params.id;
  const { pname, pcode, pamount, pdescription, variants } = req.body;

  try {
    // Parse v 
    let parsedVariants = variants;
    if (variants && typeof variants === 'string') {
      parsedVariants = JSON.parse(variants);
    }

    const updateData = { pname, pcode, pamount, pdescription };

    // Update variants 
    if (parsedVariants && Array.isArray(parsedVariants) && parsedVariants.length > 0) {
      // Validate 
      for (const variant of parsedVariants) {
        if (!variant.size || !variant.color || variant.quantity === undefined) {
          return res.status(400).json({ message: "Each variant must have size, color, and quantity" });
        }
        if (variant.size < 35 || variant.size > 44) {
          return res.status(400).json({ message: "Size must be between 35 and 44" });
        }
      }
      updateData.variants = parsedVariants;
    }

    // Handle multiple images update
    if (req.files && req.files.length > 0) {
      const imagePaths = req.files.map(file => `/uploads/${file.filename}`);
      updateData.image = imagePaths[0]; // First image 
      updateData.images = imagePaths; // images
    } else if (req.file) {
      
      updateData.image = `/uploads/${req.file.filename}`;
      
      const existingProduct = await Product.findById(id);
      if (existingProduct && existingProduct.images && existingProduct.images.length > 0) {
        updateData.images = [...existingProduct.images, `/uploads/${req.file.filename}`];
      } else {
        updateData.images = [`/uploads/${req.file.filename}`];
      }
    }

    const product = await Product.findByIdAndUpdate(id, updateData, { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    return res.status(200).json({ product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Unable to update product" });
  }
};

// Purchase Product
const purchaseProduct = async (req, res) => {
  const { quantity } = req.body; 
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    if (product.quantity < quantity) {
      return res.status(400).json({ message: "Not enough stock available" });
    }

    product.quantity -= quantity;  
    await product.save();

    return res.status(200).json({ product, message: "Purchase successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error processing purchase" });
  }
};



//calculate discounted price
const calculateDiscountedPrice = (originalPrice, discountPercentage) => {
  const discount = (originalPrice * discountPercentage) / 100;
  return originalPrice - discount;
};

//check if promotion is active
const isPromotionActive = (startDate, endDate) => {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  return now >= start && now <= end;
};

module.exports = {
  getAllProducts: async (req, res) => {
    try {
      const products = await Product.find();
      
      // Get all active promotions
      const promotions = await Promotion.find();
      const activePromotions = promotions.filter(promo => 
        isPromotionActive(promo.startDate, promo.endDate)
      );
      
      // Add promotion info to products
      const productsWithPromotions = products.map(product => {
        const productPromotion = activePromotions.find(promo => 
          promo.productId === product.pcode
        );
        
        if (productPromotion) {
          const discountedPrice = calculateDiscountedPrice(product.pamount, productPromotion.discount);
          return {
            ...product.toObject(),
            promotion: {
              id: productPromotion._id,
              title: productPromotion.title,
              discount: productPromotion.discount,
              startDate: productPromotion.startDate,
              endDate: productPromotion.endDate,
              bannerImage: productPromotion.bannerImage
            },
            originalPrice: product.pamount,
            discountedPrice: discountedPrice,
            hasActivePromotion: true
          };
        }
        
        return {
          ...product.toObject(),
          hasActivePromotion: false
        };
      });
      
      return res.status(200).json({ products: productsWithPromotions });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error fetching products" });
    }
  },
  addProducts,
  getById: async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      
      // Check for active promotion 
      const promotions = await Promotion.find();
      const activePromotions = promotions.filter(promo => 
        isPromotionActive(promo.startDate, promo.endDate)
      );
      
      const productPromotion = activePromotions.find(promo => 
        promo.productId === product.pcode
      );
      
      if (productPromotion) {
        const discountedPrice = calculateDiscountedPrice(product.pamount, productPromotion.discount);
        const productWithPromotion = {
          ...product.toObject(),
          promotion: {
            id: productPromotion._id,
            title: productPromotion.title,
            discount: productPromotion.discount,
            startDate: productPromotion.startDate,
            endDate: productPromotion.endDate,
            bannerImage: productPromotion.bannerImage
          },
          originalPrice: product.pamount,
          discountedPrice: discountedPrice,
          hasActivePromotion: true
        };
        return res.status(200).json({ product: productWithPromotion });
      }
      
      return res.status(200).json({ 
        product: {
          ...product.toObject(),
          hasActivePromotion: false
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error fetching product" });
    }
  },
  updateProduct,
  deleteProduct: async (req, res) => {
    try {
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
      return res.status(200).json({ product });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error deleting product" });
    }
  },
  purchaseProduct,
  
  // Get product with promotion details by product code
  getProductByCode: async (req, res) => {
    try {
      const { productCode } = req.params;
      const product = await Product.findOne({ pcode: productCode });
      
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      // Check for active promotion
      const promotions = await Promotion.find();
      const activePromotions = promotions.filter(promo => 
        isPromotionActive(promo.startDate, promo.endDate)
      );
      
      const productPromotion = activePromotions.find(promo => 
        promo.productId === product.pcode
      );
      
      if (productPromotion) {
        const discountedPrice = calculateDiscountedPrice(product.pamount, productPromotion.discount);
        return res.status(200).json({
          product: {
            ...product.toObject(),
            promotion: {
              id: productPromotion._id,
              title: productPromotion.title,
              discount: productPromotion.discount,
              startDate: productPromotion.startDate,
              endDate: productPromotion.endDate,
              bannerImage: productPromotion.bannerImage
            },
            originalPrice: product.pamount,
            discountedPrice: discountedPrice,
            hasActivePromotion: true
          }
        });
      }
      
      return res.status(200).json({
        product: {
          ...product.toObject(),
          hasActivePromotion: false
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Error fetching product" });
    }
  }
};
