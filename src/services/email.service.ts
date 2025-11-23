import { render } from '@react-email/render';
import { resend } from '../config/resend';
import { VerificationEmail } from '../emails/VerificationEmail';
import { ResetPasswordEmail } from '../emails/ResetPasswordEmail';
import { AdminEmail } from '../emails/AdminEmail';
import { env } from '../config/env';

const FROM_EMAIL = env.FROM_EMAIL || 'onboarding@resend.dev';
const APP_URL = env.APP_URL || 'http://localhost:3000';

export const sendVerificationEmail = async (email: string, firstName: string, token: string) => {
  const verificationUrl = `${APP_URL}/verify-email/${token}`;
  const html = await render(VerificationEmail({ firstName, verificationUrl }));

  return resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Verify your email address',
    html,
  });
};

export const sendPasswordResetEmail = async (email: string, firstName: string, token: string) => {
  const resetUrl = `${APP_URL}/reset-password/${token}`;
  const html = await render(ResetPasswordEmail({ firstName, resetUrl }));

  return resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Reset your password',
    html,
  });
};

export interface AdminEmailOptions {
  to: string[];
  subject: string;
  content: string;
  buttonText?: string;
  buttonUrl?: string;
  footerText?: string;
  previewText?: string;
}

export const sendAdminEmail = async ({
  to,
  subject,
  content,
  buttonText,
  buttonUrl,
  footerText,
  previewText,
}: AdminEmailOptions) => {
  const html = await render(
    AdminEmail({
      subject,
      content,
      buttonText,
      buttonUrl,
      footerText,
      previewText,
    })
  );

  return resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });
};
