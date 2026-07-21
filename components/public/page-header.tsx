import Image from "next/image";
import { Reveal } from "@/components/shared/reveal";

/** Photographic page header band used across public listing pages. */
export function PageHeader({
  image,
  imageAlt = "",
  title,
  children,
}: {
  image: string;
  imageAlt?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-[#121829]">
      <Image
        src={image}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-60"
      />
      <div className="hero-scrim absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-16 md:py-24">
        <Reveal>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-white md:text-5xl">
            {title}
          </h1>
        </Reveal>
        {children ? (
          <Reveal delay={0.1}>
            <div className="mt-4 max-w-2xl text-white/75 [&_a]:font-medium [&_a]:text-white [&_a]:underline [&_a]:underline-offset-2">
              {children}
            </div>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}
