// server.js
const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cors = require("cors");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret"; // 生產環境請使用環境變數

const swaggerUi = require("swagger-ui-express");
const swaggerFile = require("./swagger_output.json"); // 剛剛輸出的 JSON

// 設置 PostgreSQL 連接
const pool = new Pool({
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "auth_api",
  password: process.env.PGPASSWORD || "postgres",
  port: process.env.PGPORT || 5432,
});

// 測試數據庫連接
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("PostgreSQL 連接錯誤:", err);
  } else {
    console.log("已連接到 PostgreSQL 數據庫");
  }
});

app.use(cors());

// 使用 JSON 解析，使開發人員更便利取用處理前端傳來的資料，
app.use(express.json()); // JSON 數據
app.use(express.urlencoded({ extended: true })); // 從 form 傳出的數據

// swagger 說明文件路由
app.use("/api-doc", swaggerUi.serve, swaggerUi.setup(swaggerFile));

// 初始化數據庫表格
const initDB = async () => {
  try {
    // 創建用戶表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nickname VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 創建待辦事項表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS todos (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE
      )
    `);

    // 創建令牌黑名單表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        id SERIAL PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL
      )
    `);

    // 創建索引
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_id_completed ON todos(user_id, completed);
      CREATE INDEX IF NOT EXISTS idx_token_expires ON token_blacklist(expires_at);
    `);

    console.log("數據庫表格已初始化");
  } catch (error) {
    console.error("初始化數據庫錯誤:", error);
  }
};

// 在服務器啟動時初始化數據庫
initDB();

// 歡迎訊息
app.get("/", async (req, res) => {
  // #swagger.tags = ['Welcome']
  // #swagger.description = '歡迎訊息'
  res.status(200).send({ message: "Welcome to rocket 19 API Server 👋😄🚀💻" });
});

// 註冊路由
app.post("/users", async (req, res) => {
  // #swagger.tags = ['Users']
  // #swagger.description = '使用者註冊'
  /*	#swagger.parameters['obj'] = {
            in: 'body',
            description: '使用者註冊',
            schema: { $ref: "#/definitions/Users" }
    } */

  try {
    // step 1. 取出欄位
    const { nickname, password, email } = req.body.user;

    // step 2. 檢查必要欄位
    if (!nickname || !password || !email) {
      return res.status(400).json({ message: "所有欄位都是必填的" });
    }

    // step 3. 檢查重複的用戶名或電子郵件
    const existingUserQuery = await pool.query(
      "SELECT * FROM users WHERE nickname = $1 OR email = $2",
      [nickname, email]
    );

    if (existingUserQuery.rowCount > 0) {
      return res.status(409).json({ message: "用戶名或電子郵件已存在" });
    }

    // step 3. 密碼加密
    const hashedPassword = await bcrypt.hash(password, 10);

    // step 4. 儲存用戶到 PostgreSQL
    try {
      await pool.query(
        "INSERT INTO users (nickname, email, password) VALUES ($1, $2, $3)",
        [nickname, email, hashedPassword]
      );
    } catch (error) {
      console.error("用戶保存錯誤:", error);
      return res.status(422).json({ message: "註冊失敗" });
    }

    // step 5. 返回成功訊息
    res.status(201).json({ message: "註冊成功" });
  } catch (error) {
    console.error("註冊錯誤:", error);
    res.status(422).json({ message: "註冊失敗" });
  }
});

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

// 登入路由
app.post("/users/sign_in", async (req, res) => {
  // #swagger.tags = ['Users']
  // #swagger.description = '使用者登入'
  /*	#swagger.parameters['obj'] = {
            in: 'body',
            schema: { $ref: "#/definitions/UsersSingIn" }
    } */
  try {
    const { nickname, password, email } = req.body.user;

    // 檢查必要欄位
    if ((!nickname && !email) || !password) {
      return res
        .status(400)
        .json({ message: "請提供使用者名稱/電子郵件和密碼" });
    }

    // 從 PostgreSQL 查找用戶
    let userQuery;
    if (nickname) {
      userQuery = await pool.query("SELECT * FROM users WHERE nickname = $1", [
        nickname,
      ]);
    } else {
      userQuery = await pool.query("SELECT * FROM users WHERE email = $1", [
        email,
      ]);
    }

    // 檢查用戶是否存在
    if (userQuery.rowCount === 0) {
      return res.status(401).json({ message: "登入失敗" });
    }

    const user = userQuery.rows[0];

    // 檢查密碼是否匹配
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "登入失敗" });
    }

    // 生成 JWT
    const currentTime = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        id: user.id, // 添加用户ID以便在待辦事項API中使用
        nickname: user.nickname,
        email: user.email,
        iat: currentTime,
        exp: currentTime + 60 * 60, // 1小時後過期
      },
      JWT_SECRET
    );

    // 返回成功訊息和令牌
    res.status(200).json({
      message: "登入成功",
      token,
    });
  } catch (error) {
    console.error("登入錯誤:", error);
    res.status(401).json({ message: "登入失敗" });
  }
});

// 登出路由
app.delete("/users/sign_out", verifyToken, async (req, res) => {
  // #swagger.tags = ['Users']
  // #swagger.description = '使用者登出'
  /*	#swagger.parameters['authorization'] = {
            in: 'header',
            description: 'JWT Token'
    } */
  try {
    // 獲取令牌
    const token = req.headers.authorization.split(" ")[1];

    // 將令牌添加到黑名單
    await pool.query(
      "INSERT INTO token_blacklist (token, expires_at) VALUES ($1, $2)",
      [token, new Date(req.user.exp * 1000)]
    );

    // 清理過期令牌
    await pool.query("DELETE FROM token_blacklist WHERE expires_at < NOW()");

    res.status(200).json({ message: "登出成功" });
  } catch (error) {
    console.error("登出錯誤:", error);
    res.status(401).json({ message: "登出失敗" });
  }
});

// 1. 獲取待辦事項列表 - GET 方法
app.get("/todos", verifyToken, async (req, res) => {
  // #swagger.tags = ['Todos']
  // #swagger.description = 'TODO 列表'
  /*	#swagger.parameters['authorization'] = {
            in: 'header',
            description: 'JWT Token'
    } */
  try {
    // 從令牌中獲取用戶ID
    const userId = req.user.id;

    // 查詢該用戶的所有待辦事項
    const todosQuery = await pool.query(
      "SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    // 將數據庫列名重新映射為原始的API格式
    const formattedTodos = todosQuery.rows.map((todo) => ({
      _id: todo.id.toString(),
      userId: todo.user_id,
      title: todo.title,
      completed: todo.completed,
      createdAt: todo.created_at,
      updatedAt: todo.updated_at,
    }));

    // 返回用戶的待辦事項列表
    return res.status(200).json(formattedTodos);
  } catch (error) {
    console.error("獲取待辦事項錯誤:", error);
    return res
      .status(500)
      .json({ message: "伺服器錯誤", error: error.message });
  }
});

// 2. 新增待辦事項 - POST 方法
app.post("/todos", verifyToken, async (req, res) => {
  // #swagger.tags = ['Todos']
  // #swagger.description = 'TODO 新增'
  /*	#swagger.parameters['authorization'] = {
            in: 'body',
            description: 'JWT Token',
            schema: { $ref: "#/definitions/AddUserData" }
    } */
  try {
    // 從令牌中獲取用戶ID
    const userId = req.user.id;
    console.log("POST: 用戶ID:", userId);

    console.log("POST: 原始請求體:", req.body);
    // 從請求格式中提取待辦事項數據
    const todoData = req.body.todo;
    console.log("POST: 提取的待辦事項數據:", todoData);

    // 檢查請求體格式，支持單個對象或對象數組
    const isBulkOperation = Array.isArray(todoData);
    const todoItems = isBulkOperation ? todoData : [todoData];

    if (!todoData || todoItems.length === 0) {
      return res.status(400).json({ message: "未提供待辦事項數據" });
    }

    // 創建待辦事項
    const createdTodos = [];

    for (const item of todoItems) {
      // 取出標題並驗證
      let title = item.title;
      title = title && title.trim() !== "" ? title.trim() : undefined;

      if (title === undefined) {
        continue; // 跳過無效數據
      }

      // 插入新待辦事項到資料庫
      const insertResult = await pool.query(
        "INSERT INTO todos (user_id, title, completed, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
        [userId, title, item.completed === true, new Date().toISOString()]
      );

      console.log("POST: 插入結果:", insertResult);

      const newTodo = insertResult.rows[0];

      // 添加到結果數組，包含PostgreSQL生成的ID
      createdTodos.push({
        _id: newTodo.id.toString(),
        userId: newTodo.user_id,
        title: newTodo.title,
        completed: newTodo.completed,
        createdAt: newTodo.created_at,
      });
    }

    if (createdTodos.length === 0) {
      return res.status(400).json({ message: "所有待辦事項標題無效" });
    }

    // 決定返回格式，單個或數組
    const responseData = isBulkOperation ? createdTodos : createdTodos[0];

    // 返回創建的待辦事項
    return res.status(201).json({ todo: responseData });
  } catch (error) {
    console.error("新增待辦事項錯誤:", error);
    if (
      (error.message && error.message.includes("authentication")) ||
      error.name === "TokenExpiredError" ||
      error.name === "JsonWebTokenError"
    ) {
      return res.status(401).json({ message: "未授權" });
    } else {
      return res.status(500).json({
        message: "伺服器錯誤",
        error: error.message,
      });
    }
  }
});

// 3. 修改待辦事項 - PUT 方法
app.put("/todos/:id", verifyToken, async (req, res) => {
  // #swagger.tags = ['Todos']
  // #swagger.description = 'TODO 修改'
  /*	#swagger.parameters['authorization'] = {
            in: 'header',
            description: 'JWT Token',
    } */
  /*	#swagger.parameters['todo'] = {
            in: 'body',
            schema: { $ref: "#/definitions/UpdateUserData" }
    } */
  try {
    // 從令牌中獲取用戶ID
    const userId = req.user.id;
    console.log(`用戶ID: ${userId}`);

    // 從路徑參數獲取待辦事項ID
    const todoId = req.params.id;
    console.log(`待辦事項ID: ${todoId}`);

    // 驗證待辦事項ID格式
    if (isNaN(parseInt(todoId))) {
      return res.status(400).json({ message: "無效的待辦事項ID格式" });
    }

    // 從請求格式中提取待辦事項數據
    console.log("PUT: 原始請求體:", req.body);
    const todoData = req.body.todo || {};
    console.log("更新數據:", todoData);

    // 從請求體獲取更新的欄位
    const { title, completed } = todoData;

    // 準備更新數據和SQL查詢
    let updateFields = [];
    let queryParams = [];
    let paramCount = 1;

    // 驗證：如果標題有提供且不為空，則加入更新數據
    if (title !== undefined) {
      const cleanTitle = title && title.trim() !== "" ? title.trim() : null;
      if (cleanTitle !== null) {
        updateFields.push(`title = $${paramCount}`);
        queryParams.push(cleanTitle);
        paramCount++;
      }
    }

    // 如果完成狀態有提供，則加入更新數據
    if (completed !== undefined) {
      updateFields.push(`completed = $${paramCount}`);
      queryParams.push(!!completed); // 轉換為布林值
      paramCount++;
    }

    // 添加更新時間
    updateFields.push(`updated_at = $${paramCount}`);
    queryParams.push(new Date().toISOString());
    paramCount++;

    // 添加WHERE條件參數
    queryParams.push(todoId);
    queryParams.push(userId);

    // 如果沒有要更新的欄位
    if (updateFields.length === 0) {
      return res.status(400).json({ message: "沒有提供有效的更新欄位" });
    }

    // 構建SQL更新查詢
    const updateQuery = `
      UPDATE todos 
      SET ${updateFields.join(", ")} 
      WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
      RETURNING *
    `;

    console.log("更新SQL:", updateQuery);
    console.log("參數:", queryParams);

    // 執行更新查詢
    const result = await pool.query(updateQuery, queryParams);

    console.log("PUT: 更新操作結果:", result);

    // 如果找不到對應的待辦事項或不屬於當前用戶
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "待辦事項不存在或無權訪問" });
    }

    // 將數據庫命名格式轉換為API響應格式
    const updatedTodo = {
      _id: result.rows[0].id.toString(),
      userId: result.rows[0].user_id,
      title: result.rows[0].title,
      completed: result.rows[0].completed,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };

    // 返回更新後的待辦事項
    return res.status(200).json({ todo: updatedTodo });
  } catch (error) {
    console.error("更新待辦事項錯誤:", error);
    return res
      .status(500)
      .json({ message: "伺服器錯誤", error: error.message });
  }
});

// 4. 刪除待辦事項 - DELETE 方法
app.delete("/todos/:id", verifyToken, async (req, res) => {
  // #swagger.tags = ['Todos']
  // #swagger.description = 'TODO 刪除'

  /*	#swagger.parameters['authorization'] = {
            in: 'header',
            description: 'JWT Token'
    } */
  try {
    // 從令牌中獲取用戶ID
    const userId = req.user.id;

    // 從路徑參數獲取待辦事項ID
    const todoId = req.params.id;

    // 驗證待辦事項ID格式
    if (isNaN(parseInt(todoId))) {
      return res.status(400).json({ message: "無效的待辦事項ID格式" });
    }

    // 確保刪除的是用戶自己的待辦事項
    const result = await pool.query(
      "DELETE FROM todos WHERE id = $1 AND user_id = $2",
      [todoId, userId]
    );

    // 如果找不到對應的待辦事項或不屬於當前用戶
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "待辦事項不存在或無權訪問" });
    }

    // 返回刪除成功的訊息
    return res.status(200).json({ message: "已刪除" });
  } catch (error) {
    console.error("刪除待辦事項錯誤:", error);
    return res
      .status(500)
      .json({ message: "伺服器錯誤", error: error.message });
  }
});

// 定期清理過期令牌黑名單
setInterval(async () => {
  try {
    const result = await pool.query(
      "DELETE FROM token_blacklist WHERE expires_at < NOW()"
    );
    if (result.rowCount > 0) {
      console.log(`已清理 ${result.rowCount} 個過期令牌`);
    }
  } catch (error) {
    console.error("清理過期令牌錯誤:", error);
  }
}, 3600000); // 每小時執行一次

// 定期檢查連接狀態
setInterval(async () => {
  try {
    const result = await pool.query("SELECT 1");
    console.log("PostgreSQL 連接狀態: 已連接");
  } catch (error) {
    console.error("PostgreSQL 連接錯誤:", error);
  }
}, 60000); // 每分鐘檢查一次

// 啟動服務器
app.listen(PORT, () => {
  console.log(`服務器運行在端口 ${PORT}`);
});

// 優雅關閉
process.on("SIGINT", async () => {
  console.log("關閉應用程序...");
  try {
    await pool.end();
    console.log("PostgreSQL 連接已關閉");
    process.exit(0);
  } catch (error) {
    console.error("關閉連接錯誤:", error);
    process.exit(1);
  }
});
