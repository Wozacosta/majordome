import type { ToolActivitySource } from "@t3tools/contracts";
import { PlugIcon } from "lucide-react";

import { ToolActivityIconView } from "../chat/TimelineToolActivityIcon";
import { GmailIcon, GoogleCalendarIcon, GoogleDriveIcon, type Icon } from "../Icons";
import { serviceBrand, type ServiceBrand } from "./servicesUsed.logic";

/** The outside services an answer reached, such as Gmail, each with its own logo. */
export function ServicesUsed(props: { readonly services: ReadonlyArray<ToolActivitySource> }) {
  if (props.services.length === 0) return null;
  return (
    <ul
      aria-label="Used for this answer"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-services-used=""
    >
      {props.services.map((service) => (
        <li key={service.key} className="flex items-center gap-1.5">
          <ServiceIcon service={service} />
          {service.name}
        </li>
      ))}
    </ul>
  );
}

function ServiceIcon({ service }: { readonly service: ToolActivitySource }) {
  const brand = serviceBrand(service.name);
  if (brand !== null) {
    const Brand = SERVICE_BRAND_ICONS[brand];
    return <Brand className="size-3.5 shrink-0" aria-hidden />;
  }
  if (service.icon !== undefined) {
    return (
      <ToolActivityIconView
        icon={service.icon}
        fallbackName="wrench"
        className="size-3.5 shrink-0"
        muted={false}
      />
    );
  }
  return <PlugIcon className="size-3.5 shrink-0" aria-hidden />;
}

export const SERVICE_BRAND_ICONS: Readonly<Record<ServiceBrand, Icon>> = {
  gmail: GmailIcon,
  "google-calendar": GoogleCalendarIcon,
  "google-drive": GoogleDriveIcon,
};
