"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * A 3D eye that looks around while the page loads. The iris rides on a plane rotated in 3D so it foreshortens
 * at the edges; the lids blink; the whole eyeball tilts a little toward where it looks. GSAP drives it.
 */
export function Eye({ size = 168, className = "" }: { size?: number; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    const ctx = gsap.context(() => {
      const plane = ".iris-plane";
      const eye = ".eye";
      const look = (rx: number, ry: number, d: number) => {
        // ry positive = looks right. The iris slides and tilts; the ball tilts a third as much.
        const tl = gsap.timeline();
        tl.to(plane, { rotateY: ry, rotateX: rx, x: ry * 1.05, y: -rx * 1.05, z: 30, duration: d, ease: "power3.inOut" }, 0)
          .to(eye, { rotateY: ry * 0.35, rotateX: rx * 0.35, duration: d, ease: "power3.inOut" }, 0);
        return tl;
      };
      const blink = gsap.timeline().to(".lid-top", { y: "0%", duration: 0.09, ease: "power2.in" }, 0).to(".lid-bottom", { y: "0%", duration: 0.09, ease: "power2.in" }, 0)
        .to(".lid-top", { y: "-100%", duration: 0.16, ease: "power2.out" }, 0.1).to(".lid-bottom", { y: "100%", duration: 0.16, ease: "power2.out" }, 0.1);
      const master = gsap.timeline({ repeat: -1, repeatDelay: 0.2 });
      master.add(look(4, 30, 0.55)).add(look(-10, -26, 0.6), "+=0.25").add(blink, "-=0.1").add(look(14, 8, 0.5), "+=0.2").add(look(0, 0, 0.5), "+=0.3").add(blink, "+=0.15");
      gsap.set(".iris-plane", { transformPerspective: 500, z: 30 });
      gsap.set(".eye", { transformPerspective: 900 });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className={`eye-scene ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <div className="eye" style={{ width: size, height: size }}>
        <div className="iris-plane">
          <div className="iris">
            <span className="pupil" />
          </div>
        </div>
        <span className="glint" />
        <span className="glint-2" />
        <span className="lid lid-top" />
        <span className="lid lid-bottom" />
      </div>
    </div>
  );
}
