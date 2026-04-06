#ifndef TB3_STANDALONE_NAV__COSTMAP__COSTMAP_2D_HPP_
#define TB3_STANDALONE_NAV__COSTMAP__COSTMAP_2D_HPP_

#include <vector>
#include <mutex>
#include <memory>
#include "tb3_standalone_nav/visibility_control.h"
#include "tb3_standalone_nav/costmap/edt.hpp"

namespace tb3_standalone_nav
{
namespace costmap
{

// Standard Costmap values
static const unsigned char NO_INFORMATION = 255;
static const unsigned char LETHAL_OBSTACLE = 254;
static const unsigned char INSCRIBED_INFLATED_OBSTACLE = 253;
static const unsigned char FREE_SPACE = 0;

/**
 * @class Costmap2D
 * @brief Represents a 2D costmap grid used for path planning and local control.
 * Incorporates an inflation layer using Euclidean Distance Transform (EDT).
 */
class Costmap2D
{
public:
  TB3_STANDALONE_NAV_PUBLIC
  Costmap2D(unsigned int cells_size_x, unsigned int cells_size_y, double resolution, double origin_x, double origin_y);

  TB3_STANDALONE_NAV_PUBLIC
  virtual ~Costmap2D() = default;

  TB3_STANDALONE_NAV_PUBLIC
  unsigned char getCost(unsigned int mx, unsigned int my) const;

  TB3_STANDALONE_NAV_PUBLIC
  void setCost(unsigned int mx, unsigned int my, unsigned char cost);

  TB3_STANDALONE_NAV_PUBLIC
  unsigned int getSizeInCellsX() const { return size_x_; }

  TB3_STANDALONE_NAV_PUBLIC
  unsigned int getSizeInCellsY() const { return size_y_; }

  TB3_STANDALONE_NAV_PUBLIC
  double getResolution() const { return resolution_; }

  TB3_STANDALONE_NAV_PUBLIC
  bool worldToMap(double wx, double wy, unsigned int & mx, unsigned int & my) const;

  TB3_STANDALONE_NAV_PUBLIC
  void mapToWorld(unsigned int mx, unsigned int my, double & wx, double & wy) const;

  TB3_STANDALONE_NAV_PUBLIC
  void updateInflation(double inscribed_radius, double inflation_radius, double cost_scaling_factor);

  TB3_STANDALONE_NAV_PUBLIC
  void resetMap(unsigned int x0, unsigned int y0, unsigned int xn, unsigned int yn);

protected:
  unsigned int size_x_;
  unsigned int size_y_;
  double resolution_;
  double origin_x_;
  double origin_y_;
  std::vector<unsigned char> costmap_;
  mutable std::mutex access_;
};

}  // namespace costmap
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__COSTMAP__COSTMAP_2D_HPP_
