import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Email sender (SMTP via nodemailer). Configuration is read lazily from env:
 *   SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465),
 *   SMTP_USER, SMTP_PASS, SMTP_FROM.
 *
 * If SMTP_USER / SMTP_PASS are not set, emails are NOT sent — the OTP is logged
 * to the console instead (dev mode), so the whole flow can be tested without a
 * real mailbox. Add the SMTP_* keys to .env to switch to real delivery.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private tried = false;

  private init(): nodemailer.Transporter | null {
    if (this.tried) return this.transporter;
    this.tried = true;
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    if (!user || !pass) {
      this.logger.warn(
        'SMTP not configured — OTP emails will be logged to the console (dev mode).',
      );
      return null;
    }
    const port = Number(process.env.SMTP_PORT) || 465;
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      port,
      secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user, pass },
    });
    this.logger.log('SMTP mailer enabled');
    return this.transporter;
  }

  /** OTP email for changing the password (sent to the account's address). */
  sendPasswordOtp(to: string, code: string): Promise<void> {
    return this.sendOtp(to, code, {
      subject: 'ລະຫັດ OTP ປ່ຽນລະຫັດຜ່ານ · Password change code',
      heading: 'ລະຫັດຢືນຢັນ (OTP)',
      lead: 'ໃຊ້ລະຫັດຂ້າງລຸ່ມນີ້ ເພື່ອຢືນຢັນການປ່ຽນລະຫັດຜ່ານຂອງທ່ານ',
      leadEn: 'Use this code to confirm your password change',
    });
  }

  /** OTP email for verifying a NEW address (sent to that new address). */
  sendEmailChangeOtp(to: string, code: string): Promise<void> {
    return this.sendOtp(to, code, {
      subject: 'ລະຫັດ OTP ຢືນຢັນອີເມວໃໝ່ · Verify your new email',
      heading: 'ຢືນຢັນອີເມວໃໝ່',
      lead: 'ໃຊ້ລະຫັດຂ້າງລຸ່ມນີ້ ເພື່ອຢືນຢັນວ່າອີເມວນີ້ແມ່ນຂອງທ່ານ',
      leadEn: 'Use this code to confirm this email address is yours',
    });
  }

  /**
   * Sends an OTP email. Falls back to a console log when SMTP is not configured
   * (or the send fails), so the flow never hard-blocks.
   */
  private async sendOtp(
    to: string,
    code: string,
    copy: { subject: string; heading: string; lead: string; leadEn: string },
  ): Promise<void> {
    const t = this.init();
    if (!t) {
      this.logger.warn(`[DEV] OTP for ${to}: ${code}  (valid 10 minutes)`);
      return;
    }
    const from =
      process.env.SMTP_FROM?.trim() ||
      process.env.SMTP_USER?.trim() ||
      'no-reply@hrapp.la';
    const logo = this.logoPath();
    try {
      await t.sendMail({
        from: `"LTS HR" <${from}>`,
        to,
        subject: copy.subject,
        html: this.otpHtml(code, copy),
        attachments: logo
          ? [{ filename: 'logo.png', path: logo, cid: 'brandlogo' }]
          : undefined,
      });
      this.logger.log(`OTP email sent to ${to}`);
    } catch (e) {
      // Never block the user on a mail failure — log the code so testing works.
      this.logger.warn(
        `OTP email send failed (code logged instead): ${(e as Error).message} | OTP=${code}`,
      );
    }
  }

  /** Absolute path to the bundled email logo, or null if it's missing. */
  private logoPath(): string | null {
    const p = path.join(process.cwd(), 'assets', 'logo-email.png');
    return fs.existsSync(p) ? p : null;
  }

  /** Blue-themed, self-contained OTP email. */
  private otpHtml(
    code: string,
    copy: { heading: string; lead: string; leadEn: string },
  ): string {
    return `
<div style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
        <tr><td style="background:linear-gradient(135deg,#2EACEB 0%,#1E88E5 100%);padding:28px 24px 22px;text-align:center;">
          <img src="cid:brandlogo" alt="LTS HR" height="56" style="height:56px;max-width:200px;display:inline-block;" />
          <!-- Wordmark under the logo. The header is always blue, so it's
               white-on-blue and needs no light/dark variant. -->
          <div style="margin-top:10px;font-size:20px;line-height:1;letter-spacing:0.5px;color:#ffffff;">
            <span style="font-weight:800;">HR</span><span style="font-weight:500;opacity:0.92;"> MANAGEMENT</span>
          </div>
          <div style="margin-top:7px;font-size:9px;font-weight:600;letter-spacing:1.5px;color:#ffffff;opacity:0.85;">
            &#8212;&nbsp; PEOPLE. CULTURE. SUCCESS. &nbsp;&#8212;
          </div>
        </td></tr>
        <tr><td style="padding:34px 30px 10px;text-align:center;color:#0f172a;">
          <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">${copy.heading}</h1>
          <p style="margin:0 0 26px;font-size:14px;line-height:1.6;color:#64748b;">
            ${copy.lead}<br/>
            <span style="color:#94a3b8;font-size:12px;">${copy.leadEn}</span>
          </p>
          <div style="display:inline-block;padding:16px 30px;background:#EAF6FD;border:1px dashed #2EACEB;border-radius:14px;">
            <span style="font-size:34px;font-weight:800;letter-spacing:12px;color:#1E88E5;">${code}</span>
          </div>
          <p style="margin:26px 0 4px;font-size:13px;line-height:1.7;color:#94a3b8;">
            ⏱️ ລະຫັດນີ້ຈະໝົດອາຍຸໃນ <b style="color:#64748b;">10 ນາທີ</b><br/>
            ຖ້າທ່ານບໍ່ໄດ້ຮ້ອງຂໍ ກະລຸນາບໍ່ຕ້ອງສົນໃຈອີເມວນີ້
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:18px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #eef2f7;">
          © LTS HR — ລະບົບຄຸ້ມຄອງພະນັກງານ
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
  }
}
