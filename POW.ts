import { cry, Transaction, RLP } from 'thor-devkit';

const BN = require('bn.js')

const MaxUint256 = new BN('f'.repeat(64), 16);
const MaxUint64 = new BN('f'.repeat(16), 16);
const BaseGasPrice = new BN('1'+'0'.repeat(15));

const unsignedTxNoNonceRLP = new RLP({
    name: 'tx',
    kind: [
        { name: 'chainTag', kind: new RLP.NumericKind(1) },
        { name: 'blockRef', kind: new RLP.CompactFixedBlobKind(8) },
        { name: 'expiration', kind: new RLP.NumericKind(4) },
        {
            name: 'clauses', kind: {
                item: [
                    { name: 'to', kind: new RLP.NullableFixedBlobKind(20) },
                    { name: 'value', kind: new RLP.NumericKind(32) },
                    { name: 'data', kind: new RLP.BlobKind() },
                ],
            },
        },
        { name: 'gasPriceCoef', kind: new RLP.NumericKind(1) },
        { name: 'gas', kind: new RLP.NumericKind(8) },
        { name: 'dependsOn', kind: new RLP.NullableFixedBlobKind(32) },
        { name: 'reserved', kind: { item: new RLP.BufferKind() } },
        { name: 'origin', kind: new RLP.CompactFixedBlobKind(20) },
    ],
});
const featuresKind = new RLP.NumericKind(4);

export class POW {
    private _encodeReserved(body: Transaction.Body) {
        const reserved = body.reserved || {};
        const list = [featuresKind.data(reserved.features || 0, 'reserved.features').encode(),
            ...(reserved.unused || [])];
        // trim
        while (list.length > 0) {
            if (list[list.length - 1].length === 0) {
                list.pop();
            }
            else {
                break;
            }
        }
        return list;
    }

    // RLP encoding TX \ {nonce, sig} || origin
    encode(body: Transaction.Body, origin: string): Buffer {
        const reserved = this._encodeReserved(body);
        const obj = Object.assign({}, body, { reserved, origin: origin });
        return unsignedTxNoNonceRLP.encode(obj);
    }

    // Evaluate work = MaxUint64/hash(hash(rlp_encoding) || nonce)
    evalWork(rlp: Buffer, nonce: any): any {
        if(!BN.isBN(nonce)) {
            throw "Invalid input";
        }

        const rlpHash = cry.blake2b256(rlp);
        const nonceBuff = Buffer.from(new BN(nonce).toString(16), 'hex');

        const vHash = cry.blake2b256(rlpHash, nonceBuff);
        const vBN = new BN(vHash.toString('hex'), 16);

        return MaxUint256.div(vBN);
    }

    // Compute gas from proved work
    workToGas(work: any, blockNum: any): any {
        if(!BN.isBN(work) || !BN.isBN(blockNum)) {
            throw "Invalid input";
        }

        const w = work.div(new BN('1000', 10));
        const m = blockNum.div(new BN((3600*24*30/10).toString(10), 10));
        const g = w.mul(new BN('100').pow(m)).div(new BN('104').pow(m));
        
        if(g.gt(MaxUint64)) {
            return MaxUint64;
        } 
        
        return g;
    }

    // Compute extra gas price
    minedGasPrice(wgas: any, gas: any, coef: any): any {
        if(!BN.isBN(wgas) || !BN.isBN(gas) || !BN.isBN(coef)) {
            throw "Invalid input";
        }

        return BaseGasPrice.mul(wgas).div(gas);
    }

    getWork(tgtGas: any, blockNum: any): any {
        const m = blockNum.div(new BN((3600*24*30/10).toString(10), 10));
        const w = tgtGas.mul(new BN('104').pow(m)).div(new BN('100').pow(m)).mul(new BN('1000'));
        return w;
    }
}

// function isHexString(str: string): Boolean {
//     return /[0-9a-f]*$/i.test(str);
// }

// function uintHexStr(str: string, nBit: number): string {
//     if(nBit % 4 != 0) {
//         throw 'Invalid bit number';
//     }

//     if(!isHexString(str)) {
//         throw 'Must input hex string without 0x prefix';
//     }

//     const n = nBit/4;
//     const dif = n - str.length;
//     if(dif < 0) { return 'f'.repeat(n); }
//     return '0'.repeat(dif) + str;
// }