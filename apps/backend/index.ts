import express from "express";
import cors from "cors"
import UserRouter from "./routes/user";
import AdminRouter from "./routes/admin";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/user", UserRouter);
app.use("/admin", AdminRouter);

app.listen(process.env.PORT || 3000);