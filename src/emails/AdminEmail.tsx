import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
  Button,
  Tailwind,
} from '@react-email/components';

interface AdminEmailProps {
  subject?: string;
  previewText?: string;
  content: string;
  buttonText?: string;
  buttonUrl?: string;
  footerText?: string;
}

export const AdminEmail = ({
  subject = 'Important Message',
  previewText = 'Message from Kulangara Admin',
  content,
  buttonText,
  buttonUrl,
  footerText = 'This is an automated message from Kulangara Admin.',
}: AdminEmailProps) => {

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-gray-100 my-auto mx-auto font-sans">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[600px] bg-white">
            <Section className="mt-[32px]">
              {/* <Img
                src={`${baseUrl}/logo.png`}
                width="150"
                height="40"
                alt="Kulangara"
                className="my-0 mx-auto"
              /> */}
              <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
                Kulangara
              </Heading>
            </Section>
            <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
              {subject}
            </Heading>
            <Text className="text-black text-[14px] leading-[24px]">{content}</Text>
            {buttonText && buttonUrl && (
              <Section className="text-center mt-[32px] mb-[32px]">
                <Button
                  className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center py-[12px] px-[20px]"
                  href={buttonUrl}
                >
                  {buttonText}
                </Button>
              </Section>
            )}
            <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
            <Text className="text-[#666666] text-[12px] leading-[24px]">{footerText}</Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};
