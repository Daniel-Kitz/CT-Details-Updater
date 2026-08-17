import nodemailer, { type Transporter } from 'nodemailer';
import { interpolateTemplate, type ExtensionSettings, type PersonRecord } from '@ct-details-updater/shared';
import type { Config } from './config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: Config) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth:
        config.SMTP_USER && config.SMTP_PASSWORD
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASSWORD,
            }
          : undefined,
    });
  }

  createMessage(
    person: PersonRecord,
    settings: ExtensionSettings,
  ): MailMessage {
    const values = {
      firstName: person.firstName,
      lastName: person.lastName,
      intervalMonths: settings.intervalMonths,
      moduleUrl: settings.moduleUrl,
    };
    return {
      to: String(person.email),
      subject: interpolateTemplate(settings.emailSubject, values),
      text: interpolateTemplate(settings.emailBody, values),
    };
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.SMTP_FROM,
      ...message,
    });
  }
}
