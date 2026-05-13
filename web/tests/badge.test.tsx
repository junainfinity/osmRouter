import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge, StatusDot } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders text content", () => {
    render(<Badge tone="success">Verified</Badge>);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("renders a dot when dot prop is true", () => {
    const { container } = render(<Badge tone="warn" dot>Pending</Badge>);
    expect(container.querySelectorAll("span")).toHaveLength(2); // outer + dot
  });
});

describe("StatusDot", () => {
  it("renders an online label", () => {
    render(<StatusDot online={true} label="online" />);
    expect(screen.getByText("online")).toBeInTheDocument();
  });
  it("renders an offline label", () => {
    render(<StatusDot online={false} label="offline" />);
    expect(screen.getByText("offline")).toBeInTheDocument();
  });
});
