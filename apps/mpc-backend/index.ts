import express from "express"
import { TSSCli } from 'solana-mpc-tss-lib/mpc';

const cli = new TSSCli('devnet');

const app = express();

app.post("/create-user", async(req, res) => {
    const {userId} = req.body;
    const participant = await cli.generate();

    res.json({
        publicKey : participant.publicKey
    })

})

app.listen(3001);