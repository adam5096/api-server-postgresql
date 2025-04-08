const swaggerAutogen = require("swagger-autogen")();

const doc = {
  tags: [
    // by default: empty Array
    {
      name: "Welcome",
      description: "歡迎訊息 router",
    },
    {
      name: "Users",
      description: "使用者 router",
    },
    {
      name: "Todos",
      description: "代辦事項 router",
    },
    {
      name: "Upload",
      description: "上傳 router",
    },
  ],
  definitions: {
    Users: {
      user: {
        email: "string",
        nickname: "string",
        password: "string",
      },
    },
    UsersSingIn: {
      user: {
        email: "string",
        password: "string",
      },
    },

    // authorization: {
    //   type: "apiKey",
    //   in: "header",
    //   name: "authorization",
    //   description: "JWT Token",
    //   user: {
    //     type: "string",
    //     property: {
    //       email: {
    //         type: "string",
    //         example: "string",
    //       },
    //       password: {
    //         type: "string",
    //         example: "string",
    //       },
    //     },
    //   },
    // },
    AddUserData: {
      todo: {
        title: "string",
        fileUrl: "string",
      },
    },
    UpdateUserData: {
      todo: {
        title: "string",
        fileUrl: "string",
      },
    },
  },
  components: {
    schemas: {
      // User: {
      //   type: "object",
      //   properties: {
      //     user: {
      //       type: "object",
      //       properties: {
      //         email: {
      //           type: "string",
      //           example: "string",
      //         },
      //         password: {
      //           type: "string",
      //           example: "string",
      //         },
      //       },
      //     },
      //   },
      // },
    },
  },
};

const outputFile = "./swagger_output.json"; // 輸出的文件名稱
const endpointsFiles = ["./app.js"]; // 要指向的 API，通常使用 Express 直接指向到 app.js 就可以

swaggerAutogen(outputFile, endpointsFiles, doc); // swaggerAutogen 的方法
