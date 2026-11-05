const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const META_API_VERSION = "v18.0";

interface MetaEventUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
}

interface MetaEventCustomData {
  loan_amount?: number;
  loan_purpose?: string;
  currency?: string;
  value?: number;
  content_name?: string;
}

interface MetaEvent {
  event_name: string;
  event_time: number;
  action_source: "website";
  event_source_url?: string;
  user_data: MetaEventUserData;
  custom_data?: MetaEventCustomData;
}

export async function sendMetaEvent(event: MetaEvent): Promise<boolean> {
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    console.log(
      "Meta CAPI not configured, skipping event:",
      event.event_name
    );
    return false;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [event],
          access_token: META_ACCESS_TOKEN,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Meta CAPI error:", errorData);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Meta CAPI request failed:", error);
    return false;
  }
}

export async function trackLeadEvent(data: {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  ipAddress: string;
  userAgent: string;
  loanAmount: number;
  loanPurpose: string;
  sourceUrl?: string;
}): Promise<void> {
  await sendMetaEvent({
    event_name: "Lead",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: data.sourceUrl,
    user_data: {
      em: [data.email.toLowerCase().trim()],
      ph: [data.phone.replace(/\D/g, "")],
      fn: [data.firstName.toLowerCase().trim()],
      ln: [data.lastName.toLowerCase().trim()],
      client_ip_address: data.ipAddress,
      client_user_agent: data.userAgent,
    },
    custom_data: {
      loan_amount: data.loanAmount,
      loan_purpose: data.loanPurpose,
      currency: "USD",
      value: data.loanAmount,
      content_name: "Personal Loan Application",
    },
  });
}
