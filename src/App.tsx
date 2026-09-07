import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Landing } from './pages/Landing';
import { Play } from './pages/Play';
import { Lobby } from './pages/Lobby';
import { Blackjack } from './pages/Blackjack';

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Landing />} />
        <Route path="/play" element={<Play />} />
        <Route path="/lobby/:code" element={<Lobby />} />
        <Route path="/blackjack" element={<Blackjack />} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AnimatedRoutes />
    </HashRouter>
  );
}
