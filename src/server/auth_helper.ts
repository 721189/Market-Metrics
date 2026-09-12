import crypto from 'crypto';

// Real cryptographic JWT sign and verify library using pure Node.js crypto module (no extra dependencies)
const JWT_SECRET = process.env.JWT_SECRET || 'market_research_agent_v2_ultra_secret_key_987654321';

export class CryptographyAuth {
  public static sign(payload: Record<string, any>, expiresInSeconds = 86400): string {
    const header = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const fullPayload = {
      ...payload,
      exp,
    };
    const payloadBase64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

    const signatureInput = `${headerBase64}.${payloadBase64}`;
    const signature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(signatureInput)
      .digest('base64url');

    return `${signatureInput}.${signature}`;
  }

  public static verify(token: string): Record<string, any> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerBase64, payloadBase64, signature] = parts;
      const signatureInput = `${headerBase64}.${payloadBase64}`;
      const expectedSignature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(signatureInput)
        .digest('base64url');

      if (signature !== expectedSignature) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
      if (payload.exp && Date.now() / 1000 > payload.exp) {
        // Expired
        return null;
      }

      return payload;
    } catch (err) {
      return null;
    }
  }
}
