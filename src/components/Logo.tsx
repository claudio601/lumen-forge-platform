import { Link } from "react-router-dom";

export default function Logo({ className = "" }: { className?: string }) {
  return (
      <Link to="/" className={`flex items-center gap-3 shrink-0 ${className}`}>
            <img
                    src="/logo.svg"
                            alt="eLIGHTS Logo"
                                    className="w-10 h-10 object-contain"
                                          />
                                                <div className="text-[#534AB7] font-['Montserrat'] text-xl flex items-baseline tracking-tight">
                                                        <span className="font-bold">eLIGHTS</span>
                                                                <span className="font-normal">.cl</span>
                                                                      </div>
                                                                          </Link>
                                                                            );
                                                                            }