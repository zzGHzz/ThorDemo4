import { Driver, SimpleNet } from '@vechain/connex.driver-nodejs';
import { Framework } from '@vechain/connex-framework';
import { POW } from './POW';
import { cry, Transaction } from 'thor-devkit';

const BN = require('bn.js');

function numToHexStr(num: number): string {
    return "0x" + new BN('' + Math.floor(num)).toString(16);
}

let body: Transaction.Body = {
    chainTag: 0,
    blockRef: '0x' + '0'.repeat(16),
    expiration: 30,
    clauses: [{
        to: '0x564B08C9e249B563903E06D461824b5d6b7F2968',
        value: numToHexStr(1e18),
        data: '0x'
    }],
    gasPriceCoef: 0,
    gas: 21000,
    dependsOn: null,
    nonce: '0x0'
}

const pow = new POW();
const RandMax = 2 ** 64;

function mine(rlp: Buffer, second: number): number {
    let nonce: number = 0;
    let w = new BN('0');

    const start = new Date().getTime();
    let now = 0;

    let i = 0;
    for (; ; i++) {
        let tnonce = Math.random() * RandMax;

        const tw = new BN(pow.evalWork(rlp, new BN('' + tnonce)));

        if (tw.gt(w)) {
            w = tw.clone();
            nonce = tnonce;
        }

        if (i % 1e5 === 0) {
            now = new Date().getTime();
            if (now - start >= second * 1000) {
                break;
            }
        }
    }

    console.log("Proved work = " + w.toString(10));
    console.log("nonce = " + nonce);
    console.log("Round numbe = " + i);
    console.log("Duration (sec) = " + (now - start) / 1000);
    return nonce;
}

const sk = '0x3c6f1c52984a4d58507ed542689237c01c9a3fcaacc7c3b1b1fbee62910e35f2';
const origin = '0xe4660c72dea1d9fc2a0dc2b3a42107d37edc6327';

(async () => {
    try {
        const net = new SimpleNet("https://sync-testnet.vechain.org");
        const driver = await Driver.connect(net);
        const connex = new Framework(driver);

        // Get info of the latest block
        const lastBlock = await connex.thor.block().get();
        if (lastBlock === null) {
            throw "Cannot get the latest block";
        }

        // Set chainTag and blockRef
        body.chainTag = parseInt(connex.thor.genesis.id.slice(-2), 16);
        body.blockRef = lastBlock.id.slice(0, 18);

        // Mining
        const duration = 100;
        const rlp = pow.encode(body, origin);
        body.nonce = numToHexStr(mine(rlp, duration));
        
        // Prepare TX
        const tx = new Transaction(body);
        const signingHash = cry.blake2b256(tx.encode());
        tx.signature = cry.secp256k1.sign(signingHash, Buffer.from(sk.slice(2), 'hex'));
        const raw = '0x' + tx.encode().toString('hex');

        // Send TX
        let ret = await net.http("POST", 'transactions', {
            headers: { 'x-genesis-id': connex.thor.genesis.id },
            query: {},
            body: { raw }
        });
        console.log('TXID = ' + ret.id);

        // Get receipt
        const tx1 = connex.thor.transaction(ret.id);
        const TIMEOUT = 5;
        const ticker = connex.thor.ticker();
        for (let i = 0; i < TIMEOUT; i++) {
            await ticker.next();
            ret = await tx1.getReceipt();
            if (ret != null) {
                break;
            }
            if (i === TIMEOUT) {
                throw "Timeout";
            }
        }

        // Print out results 
        console.log('Reward (VTHO) = ' + parseInt(ret.reward.slice(2), 16) / 1e18);
        const blockNum = ret.meta.blockNumber
        const work = pow.evalWork(rlp, new BN(body.nonce.slice(2), 16));
        const workToGas = pow.workToGas(work, new BN('' + blockNum));
        console.log('Mined Gas = ' + workToGas.toString(10));
        const minedGasPrice = pow.minedGasPrice(workToGas, new BN('' + body.gas), new BN('' + body.gasPriceCoef));
        console.log('Mined GasPrice = ' + minedGasPrice.toString(10));
    } catch (err) { console.log(err) }
})();