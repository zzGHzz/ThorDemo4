import { Driver, SimpleNet } from '@vechain/connex.driver-nodejs';
import { Framework } from '@vechain/connex-framework';
import { POW } from './POW';
import { cry, Transaction } from 'thor-devkit';

const BN = require('bn.js');
const pow = new POW();

// TX body
let body: Transaction.Body = {
    chainTag: 0,
    blockRef: '0x' + '0'.repeat(16),
    expiration: 30,
    clauses: [{
        to: '0x564B08C9e249B563903E06D461824b5d6b7F2968',
        value: safeToHexString(1e18),
        data: '0x'
    }],
    gasPriceCoef: 0,
    gas: 21000,
    dependsOn: null,
    nonce: '0x0'
}

// Private key and account address
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

        // TX PoW
        const duration = 100;
        const rlp = pow.encode(body, origin);
        body.nonce = safeToHexString(mine(rlp, duration));
        
        printSeperator();

        // Prepare and send TX
        const raw = '0x' + prepareTX(body, sk).toString('hex');
        let ret = await net.http("POST", 'transactions', {
            headers: { 'x-genesis-id': connex.thor.genesis.id },
            query: {},
            body: { raw }
        });
        const txid = ret.id;
        console.log('TXID = ' + txid);

        printSeperator();

        // Get receipt
        const timeout = 5; // measured in terms of the number of blocks
        const receipt = await getTXReceipt(txid, timeout, connex);

        /** 
         * Compute added gasprice from TX reward
         * totalGasPrice = reward / gasUsed / 0.3
         * addedGasPrice = totalGasPrice - baseGasPrice * gasPriceCoef
         */  
        console.log('TX reward (VTHO) = ' + parseInt(receipt.reward.slice(2), 16) / 1e18);
        const totalGasPrice = new BN(receipt.reward.slice(2), 16)
                                .div(new BN('' + receipt.gasUsed))
                                .mul(new BN('10')).div(new BN('3'));
        console.log('Total gas price = ' + totalGasPrice.toString(10));
        const BASE_GASPRICE = new BN('' + 1e15);
        const addedGasPrice = totalGasPrice.sub(BASE_GASPRICE.mul(new BN('' + body.gasPriceCoef)).add(BASE_GASPRICE));
        console.log('Added gas price = ' + addedGasPrice.toString(10));

        printSeperator();

        // Compute added gasprice from PoW
        const blockNum = receipt.meta.blockNumber
        const work = pow.evalWork(rlp, new BN(body.nonce.slice(2), 16));
        const workToGas = pow.workToGas(work, new BN('' + blockNum));
        console.log('Gas convered from Work = ' + workToGas.toString(10));
        const minedGasPrice = pow.minedGasPrice(workToGas, new BN('' + body.gas), new BN('' + body.gasPriceCoef));
        console.log('Mined gas price = ' + minedGasPrice.toString(10));
    } catch (err) { console.log(err) }
})();

function mine(rlp: Buffer, second: number): number {
    const RandMax = 2 ** 64;

    let nonce: number = 0;
    let w = new BN('0');

    const start = new Date().getTime();
    let now = 0;

    let i = 0;
    for (; ; i++) {
        let tnonce = Math.random() * RandMax;

        const tw = new BN(pow.evalWork(rlp, new BN('' + tnonce)));

        if (tw.gt(w)) {
            w = tw;
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
    console.log("Nonce = " + nonce);
    console.log("Number of rounds = " + i);
    console.log("Duration (sec) = " + (now - start) / 1000);
    return nonce;
}

function safeToHexString(num: number): string {
    const flooredNum = Math.floor(num);

    if (flooredNum <= Number.MIN_SAFE_INTEGER) {
        return flooredNum.toString(16);
    }
    return "0x" + new BN('' + flooredNum).toString(16);
}

function prepareTX(body: Transaction.Body, sk: string): Buffer {
    const tx = new Transaction(body);
    const signingHash = cry.blake2b256(tx.encode());
    tx.signature = cry.secp256k1.sign(signingHash, Buffer.from(sk.slice(2), 'hex'));
    return tx.encode();
}

async function getTXReceipt(txid: string, timeout: number, connex: Connex): Promise<Connex.Thor.Receipt> {
    const tx = connex.thor.transaction(txid);
    const ticker = connex.thor.ticker();
    for (let i = 0; i < timeout; i++) {
        await ticker.next();
        const ret = await tx.getReceipt();
        if (ret != null) {
            return new Promise((resolve, reject) => { resolve(ret); });
        }
    }
    throw "Timeout";
}

function printSeperator() {
    console.log('');
    console.log('----------------------------------');
    console.log('');
}