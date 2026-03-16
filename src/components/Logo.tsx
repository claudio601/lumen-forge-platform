import { Link } from "react-router-dom";

export default function Logo({ className = "" }: { className?: string }) {
        return (
                    <Link to="/" className={`shrink-0 ${className}`}>
                              <img src="/logo.svg" alt="eLIGHTS Logo" className="h-9 w-auto" />
                    </Link>
        );
}