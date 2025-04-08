const express = require("express");
const router = express.Router();
const dotenv = require("dotenv");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

// 載入環境變數
dotenv.config();

// 設置 PostgreSQL 連接
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

// JWT 驗證中間件
const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "未提供 JWT 令牌" });
  }

  try {
    // 檢查令牌是否被列入黑名單
    const blacklistedTokenQuery = await pool.query(
      "SELECT * FROM token_blacklist WHERE token = $1",
      [token]
    );

    if (blacklistedTokenQuery.rowCount > 0) {
      return res.status(401).json({ message: "登出狀態，請重新登入" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: "JWT 令牌無效" });
  }
};

// 從環境變數中取得 AWS 設定
const {
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    S3_BUCKET_REGION,
    BUCKET_NAME,
} = process.env;

// 建立新的 S3 用戶端實例
const s3Client = new S3Client({
    region: S3_BUCKET_REGION,
    credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
});

// 設定 multer 的儲存和檔案過濾規則
const storage = multer.memoryStorage(); // 使用記憶體儲存，因為我們要直接上傳到 S3

const fileFilter = (req, file, cb) => {
    // 這裡可以設定允許的檔案類型
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 限制檔案大小為 5MB
    }
});

// 展示歡迎訊息
router.get("/", verifyToken, (req, res) => {
    // #swagger.tags = ['Upload']
    // #swagger.description = '上傳檔案確認頁'
    /*	#swagger.parameters['authorization'] = {
              in: 'header',
              description: 'JWT Token'
      } */
    res.status(200).json({ message: "這裡是上傳頁面" });
});

// 處理檔案上傳到 S3 的路由
router.post("/", verifyToken, upload.single('file'), async (req, res) => {
    // #swagger.tags = ['Upload']
    // #swagger.description = '上傳檔案'
    /*	#swagger.parameters['authorization'] = {
              in: 'header',
              description: 'JWT Token'
      } */
    try {
        if (!req.file) {
            return res.status(400).json({ error: "未選擇檔案" });
        }

        // 生成唯一的檔案名稱
        const fileExtension = req.file.originalname.split('.').pop();
        const fileName = `${uuidv4()}.${fileExtension}`;

        // 設定 S3 上傳參數
        const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        };

        // 執行上傳到 S3
        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);

        // 回傳成功訊息和檔案資訊
        res.status(201).json({
            message: "上傳成功",
            fileUrl: `https://${BUCKET_NAME}.s3.${S3_BUCKET_REGION}.amazonaws.com/${fileName}`,
            fileName: fileName
        });

    } catch (error) {
        console.error("Error uploading file:", error);
        res.status(500).json({
            error: "上傳失敗",
            details: error.message
        });
    }
});

module.exports = router;