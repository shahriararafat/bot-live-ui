import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OfficeFloor } from "@/components/office-floor";
import { COOKIE_NAME, verifySession } from "@/lib/session";
import { getOffice } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const jar = await cookies();
  if (!verifySession(jar.get(COOKIE_NAME)?.value)) redirect("/login");
  const office = await getOffice();
  return <OfficeFloor initial={office} />;
}
