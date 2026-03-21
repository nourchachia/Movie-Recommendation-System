'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, User, Bookmark, TrendingUp, Compass, Home } from 'lucide-react';

export default function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <header
            className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'navbar-blur' : 'bg-gradient-to-b from-black/80 to-transparent'
                }`}
        >
            <nav
                className="mx-auto max-w-[1440px] flex items-center justify-between"
                style={{ paddingLeft: '48px', paddingRight: '48px', height: '80px' }}
            >
                {/* Logo */}
                <Link href="/" className="flex items-center gap-2.5 group">
                    <div className="relative w-8 h-8 flex items-center justify-center">
                        <div className="absolute inset-0 bg-[#E50914] rounded-sm opacity-90 group-hover:opacity-100 transition-opacity" />
                        <svg className="relative z-10 w-5 h-5 text-white" viewBox="0 0 24 24" fill="none">
                            <rect x="2" y="2" width="4" height="4" rx="0.5" fill="white" />
                            <rect x="10" y="2" width="4" height="4" rx="0.5" fill="white" />
                            <rect x="18" y="2" width="4" height="4" rx="0.5" fill="white" />
                            <rect x="2" y="10" width="20" height="12" rx="1" fill="white" />
                            <circle cx="12" cy="16" r="2.5" fill="#E50914" />
                        </svg>
                    </div>
                    <span
                        className="text-white font-black text-xl tracking-wider uppercase"
                        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.15em' }}
                    >
                        Flicker
                    </span>
                </Link>

                {/* Nav Links */}
                <ul className="hidden md:flex items-center" style={{ gap: '8px' }}>
                    {[
                        { label: 'Home', href: '/', icon: <Home size={15} />, active: true },
                        { label: 'Discover', href: '/discover', icon: <Compass size={15} /> },
                        { label: 'Trending', href: '/trending', icon: <TrendingUp size={15} /> },
                        { label: 'My List', href: '/mylist', icon: <Bookmark size={15} /> },
                    ].map(({ label, href, icon, active }) => (
                        <li key={label}>
                            <Link
                                href={href}
                                className={`relative flex items-center font-medium transition-all duration-200 rounded-md ${active ? 'text-white' : 'text-[#A3A3A3] hover:text-white'
                                    }`}
                                style={{ gap: '6px', padding: '10px 20px', fontSize: '16px' }}
                            >
                                <span className={active ? 'text-[#E50914]' : ''}>{icon}</span>
                                {label}
                                {active && (
                                    <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-[#E50914] rounded-full" />
                                )}
                            </Link>
                        </li>
                    ))}
                </ul>

                {/* Right Actions */}
                <div className="flex items-center" style={{ gap: '12px' }}>
                    {/* Search */}
                    <div className={`flex items-center transition-all duration-300 ${searchOpen ? 'w-48' : 'w-9'} overflow-hidden`}>
                        {searchOpen && (
                            <input
                                autoFocus
                                onBlur={() => setSearchOpen(false)}
                                className="w-full bg-[#1C1C1C] border border-[#2A2A2A] text-white text-sm px-3 py-1.5 rounded-l-md outline-none placeholder:text-[#A3A3A3] focus:border-[#E50914] transition-colors"
                                placeholder="Search movies..."
                            />
                        )}
                        <button
                            onClick={() => setSearchOpen(true)}
                            className={`flex-shrink-0 w-9 h-9 flex items-center justify-center text-[#A3A3A3] hover:text-white transition-colors ${searchOpen ? 'bg-[#E50914] text-white rounded-r-md' : 'hover:bg-white/10 rounded-full'
                                }`}
                        >
                            <Search size={18} />
                        </button>
                    </div>

                    {/* Sign In button */}
                    <Link
                        href="/login"
                        className="flex items-center font-semibold text-white border border-white/30 hover:border-white hover:bg-white/10 rounded-lg transition-all duration-200"
                        style={{ gap: '7px', padding: '8px 20px', fontSize: '15px' }}
                    >
                        <User size={16} />
                        Sign In
                    </Link>
                </div>
            </nav>
        </header>
    );
}
